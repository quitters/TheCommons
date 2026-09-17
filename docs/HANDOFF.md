# The Commons — development handoff

Updated: 2026-09-17.

**The Commons is live in production** at <https://synthograsizer.com/thecommons>, hosted inside the Synthograsizer suite. Any signed-in Synthograsizer account can create a room, generate art into it with Gemini, put the wall on a screen, and let people scan a QR to take a control. This document describes the deployed system, how to deploy it again, what is and isn't verified, and what's left.

> **Read this before trusting the rest.** There is work finished but **not yet deployed**: branch `commons/room-state-events` in `synthograsizer-suite` (three commits, `cbeb6f1` → `b902db2`), built off `main` in a worktree and **not pushed**. It adds persistent sketch state, participant actions, presence, and room deletion. Production is still `da532d5` and does **not** have any of it. Sections below mark the difference; "What is live" means live.

This repo (`TheCommons`) is now the **origin of the design and the reference implementation**, not the thing that runs in production. The hosted product lives in `synthograsizer-suite`. The standalone Node app here still runs locally and is still the place the two sketch contracts are defined.

---

## What is live

**Where:** `synthograsizer-suite` on `origin/main`, commit **`da532d5`**, deployed to Cloud Run service `synthograsizer` (project `synthograsizer-app`, region `northamerica-northeast1`, Cloud SQL Postgres `synth-db`), fronted by a Vercel proxy on the domain.

**The shape of it** — Commons runs *inside* the suite's existing FastAPI app, not as a separate service:

| Piece | Where it lives |
|---|---|
| HTTP API + WebSocket relay | `backend/routers/thecommons.py` |
| Per-room realtime state | `backend/service/thecommons_relay.py` |
| Jobs, room state, presets, undo | `backend/service/thecommons_jobs.py` |
| Gemini generation + repair pass | `backend/service/thecommons_generate.py` |
| Sketch validation | `backend/service/thecommons_validate.py` |
| Inherited p5 template library | `backend/service/thecommons_data/templates/` (27 usable of 28) |
| Browser client | `static/thecommons/` |
| Schema (v4) | `commons_rooms`, `commons_room_state`, `commons_room_jobs` in `backend/service/schema.sql` |

**Public routes:** `/thecommons/` (room list), `/thecommons/desk/?room=<id>` (creator desk), `/thecommons/display/{joinCode}` (the wall), `/thecommons/join/{joinCode}` (participant station). The last two are `FileResponse` routes, because StaticFiles can't route a path segment and the join URL must be a path — it's what the QR encodes.

**Why it's a port into FastAPI rather than a second service.** The suite already had this exact situation with **ChatRoom**: a Node app making its own server-side Gemini calls, which was deliberately never hosted because it "would have to be credit-metered first" (`REPO_MAP.md`). Running Commons as its own service would have meant reimplementing session verification, the credit ledger, and the budget breaker in a second language against the same database. Porting into FastAPI meant room isolation, WebSocket auth, and job durability were built once, directly against `request.state.user`, `credits.Charge`, and Postgres.

---

## The `room` argument — built, not yet deployed

*Branch `commons/room-state-events`. Everything in this section is on that branch only.*

Until this, every piece was a pure function of time, knobs and audio: the draw body re-runs each frame with nothing carried between calls, so a sketch had nowhere to keep a bullet once it was fired. Games, scores, accumulation — all impossible. The native call gained a fifth argument:

```js
drawFn(ctx, frame, getVar, audio, room)
// room.state  — persistent across frames, cleared when the piece changes
// room.events — participant actions since the last frame
// room.people — who is connected, each with a stable hue
```

The p5 path reaches the same data through `p.getRoomState()` / `getEvents()` / `getPeople()`, never the native signature — the two contracts stay separate. Inherited templates never call them.

**State is display-local on purpose.** Never serialised, never sent anywhere. Syncing game state through the relay at 60fps would be absurd, and displays are already unsynchronised — each analyses its own microphone. Two walls on one room diverge, which is the existing trade-off rather than a new one. It also adds no capability a sketch lacked (it could already use `window`); it gives one a scoped home that gets cleared properly. Note one consequence: because state never round-trips through JSON, sketches can and do store **functions** in it. Anything that later tries to persist or sync `room.state` breaks that.

**New control type:** `{"type": "trigger", "share": "all" | "one"}`. A trigger fires events rather than holding a value: it sets nothing, takes no hold, and needs no `promptTemplate` placeholder. `share` is valid **only** on a trigger — a shared slider is several people overwriting one value with no turn-taking, which is exactly what the 4s hold exists to prevent. At least one control must stay assignable, or `distribute()` has nothing to hand out.

**The system prompt is composed, not monolithic:** a shared base plus an interactive block, chosen by a checkbox on the creator desk. A model reaches for whatever is in front of it, so a prompt explaining SHOOT buttons will put one on a moiré study; an ambient piece is never told triggers exist, and two rounds of live generation confirmed it never produces them. Routing is a user choice, never a classifier call — that would be a second billed call on a feature already charging 2×. Remixing a piece that already has triggers force-upgrades to the interactive prompt, decided under the room lock, or the buttons would vanish from the remix with nothing to explain it. The repair pass must reuse the *same* prompt for the same reason.

Also on this branch: a per-participant token bucket on the WebSocket message loop, which previously had **no throttle at all** on an anonymous socket, and `DELETE /api/thecommons/rooms/{id}`.

---

## Access and spend model

| Action | Requires | Spends |
|---|---|---|
| Open the landing page | nothing | — |
| Create a room, list your rooms | verified Google session | nothing |
| Generate / remix / undo / presets | Google session **and** server-checked ownership of that room | **10 credits** from the owner |
| Scan QR, take a control | **nothing — no account, no login** | — |
| View a wall | the join link | — |

**One API key — the operator's — behind everything.** Credits are not money and are not bought; they're an integer column (`users.credits_balance`) rationing how much of that key an account can consume. Users spend an allowance; the operator pays the actual Gemini bill. At 300 free credits/month that's **30 Commons generations per account per month**, shared with the suite's other paid features.

**Pricing**: a `commons_sketch` action at 2× the Pro text rate, because one generation can legitimately be *two* Pro calls (the initial one plus the validation-aware repair pass). The repair is decided deep inside the generator, long after the request that could have returned a 402, so the worst case is reserved up front — that can never under-charge and needs no partial-refund mechanism, which `Charge` has no notion of.

**Measured repair rate: 1 in 5** (6 model calls for 5 generations, 2026-09-17, `gemini-3.1-pro-preview`, against the composed prompt). The tariff charges for 2 calls and the observed average is 1.2, so it **over-charges by roughly 40%** on this sample. That is the intended direction — reserving the worst case is what makes the 402 honest — but if credits ever feel tight, this is the first number to revisit, with a bigger sample. The one repair was a `promptTemplate` placeholder mismatch, and the repaired output was correct.

**Reserve happens last**, after the idempotency check, the busy-room check, and the remix-staleness check have all passed — so a replay, a busy room, or a stale remix can never silently burn credits, and there's no refund-on-rejection dance. It's inside the room lock, so reserve and insert can't interleave.

**Refund policy**: the charge **stands** whenever the model actually answered — Google billed that response whether or not we could parse it, and "model replied with junk" is the one outcome a user can provoke deliberately, so refunding it would fund unlimited retries on the operator's key. Everything else refunds in full: no key configured, rejected input, transport failure.

> **A room owner is not a suite operator.** Never add a room creator to `ADMIN_EMAILS` or grant the `admin` tier. That tier bypasses credit debits, per-user rate limiting, *and* the daily budget breaker — suite-wide, for every tool, not just Commons. It is also why the operator's own Commons usage is effectively uncapped.

---

## Deploying it

Run from a **fresh Cloud Shell clone of `main`** — `cd ~/synthograsizer` first. `--source .` from the home directory finds no Dockerfile, silently falls back to Buildpacks, and fails; that has now bitten twice.

Three **separate** commands, never `&&`-chained, because `--set-env-vars` **replaces the entire service environment** (the 2026-07-20 incident that dropped `SYNTH_PUBLIC_ORIGINS` and 403'd every POST through the domain):

1. **§2** — `gcloud run deploy synthograsizer --source . …` with the full env list, which must include **`SYNTH_WS_ORIGIN=https://synthograsizer-679278101913.northamerica-northeast1.run.app`**
2. **§2b** — re-apply `SYNTH_PUBLIC_ORIGINS` (note the `^@^` delimiter switch; the value contains a comma)
3. **§2c** — re-apply `SYNTH_GCS_BUCKET` + `SYNTH_TERMS_VERSION`

Exact commands live in the suite's own `docs/DEPLOY_CLOUDRUN.md`. A correct run leaves **three revisions ~15s apart**; a lone revision means 2b/2c were skipped.

Commons added exactly **one** env var (`SYNTH_WS_ORIGIN`) and **one** dependency (`qrcode`, whose image backend Pillow was already present). No new secrets. The schema migrates at app startup, and Cloud Run won't route traffic to a revision that fails to boot — so a bad migration leaves the previous revision serving rather than breaking the site.

---

## Verified, and not

**Verified in production:**

- The **migration ran for real** against Cloud SQL — the revision booted, which is the proof, since `_migrate()` runs at startup.
- Commons pages, assets, and both path-routed pages serve through the domain.
- A QR for an unknown room 404s; anonymous `POST /api/thecommons/generate` returns **401**. The spend gate holds.
- WebSocket upgrades reach the relay and a real room's wall renders (after the fix below).

**Verified locally only** (driven end-to-end in a browser against a dev harness, since the dev machine has no Postgres): room creation → generation → wall renders the native Canvas2D piece → second tab joins → a control change repaints the wall → an inherited p5 template renders through its separate path and labels itself "Library piece". Credit reserve/refund behaved correctly through the real UI.

**Verified on the `room` branch, locally** — worth recording because it is more than a smoke test:

- **Nine live-generated sketches across two rounds, 9/9 valid, 0 fallbacks.** Round two deliberately asked for things the old contract could not express: a per-table scoreboard, colliding marble physics, a timed round state machine with a gallery of past rounds, a breeding ecosystem, a reaction-diffusion field.
- Each ran **1800 frames headlessly** against a recording stub canvas without throwing, driven exactly as `display.js` drives them.
- **Per-participant attribution is real, not decorative.** With alice firing 3× as often as bob and cara never firing: `scores = {alice: 580, bob: 500}`, hues captured from `room.people`, and **no entry at all for cara**.
- A **differential run** (same frames, events on vs off, audio silenced) proved the events channel drives the pieces: the fireworks piece draws literally nothing but its background with events off.
- **Soaked ten simulated minutes:** all state plateaus. Ink Drifts locks at exactly 2003, the mural at ~2800, the tower defence peaks at 165 then *declines* to 73, the ecosystem settles around ~8100.
- **JS cost per frame is within budget** for all nine; the reaction-diffusion field is heaviest at 6.28ms, leaving ~10ms to rasterise.
- In a real browser: invaders destroyed by two phones **stay** destroyed across hundreds of frames; both `share` modes behaved (everyone could Launch, only one person had Grand Finale); deleting a room strands its live participant with "This room isn't open".

**Still not verified at all:**

- **Real phones.** Everything so far has been desktop browsers. The QR has never actually been scanned.
- **Load.** No measurement of simultaneous rooms, participants per room, update rates, latency, or memory. Publish measured capacity, never assumptions. The `room` work makes this more pressing, not less: a mashable button is a new traffic shape, and the token bucket's 40/s cap is a guess nobody has load-tested.
- **Long sessions and reconnects** under real conditions, including the Cloud Run 600s request timeout against long-lived sockets.
- **Restart behavior** with live participants attached.
- **Real GPU rasterising cost.** Every headless number above is JS only — the stub canvas draws nothing. The reaction-diffusion piece issues ~17k draw ops per frame and has never been watched on a real wall.

---

## What's left, roughly in priority order

0. **Merge and deploy the `room` branch.** Three commits sitting unpushed in a worktree. Everything above about state, events, presence and room deletion is inert until this ships. It needs no schema change, no new env var, and no new dependency — the deploy is the ordinary three-command run below.
1. **Invitation lifecycle — half done.** `DELETE /api/thecommons/rooms/{id}` exists now, ownership-checked, with a button on the room list and a confirmation that names what it destroys (presets are job rows, so they go too). Still missing: **close, reopen, expire, rotate** — no way to retire a join code while *keeping* the room and its presets, which is what you actually want after an event you might repeat. The `status` column and the 4404/404 paths exist and are honored; nothing sets them.
2. **Untrusted-creator sandboxing.** Generated drawing code still runs on the **same origin as the signed-in page**. That is acceptable while creators are the owner and people he trusts; it is the thing to close before opening room creation to the public. A sandboxed frame on a separate origin with a narrow validated message interface is the shape. The `room` work does not widen the hole — a sketch could already reach `window` — but it makes generated code materially more capable and more worth writing, so the gap is worth more attention than before.
3. **Durable job recovery.** A job interrupted by a restart is marked `interrupted` and never resumed. Provider-outcome uncertainty isn't recorded for explicit recovery either.
4. **Multi-instance.** The relay registry is in-process, which is only safe because the service is pinned to `--min-instances 1 --max-instances 1`. Scaling past one instance needs shared relay state *and* shared rate-limit/budget state first — the suite's own runbook says the same.
5. **Real-phone and load testing** (above).
6. **Facilitator.** Still disabled. Needs per-room opt-in, consent, and its own reserve/commit/refund wiring before it can autonomously spend.

---

## Traps worth knowing

These each cost real time. They are not obvious from the code.

**The canvas context outlives the frame, and generated sketches leak state into it.** A live-generated fireworks piece set `globalCompositeOperation = 'lighter'` and never restored it, so the *next* frame's background wash ran additively: the canvas saturated to solid cyan and every firework blew out to white. Nothing about that code is invalid, so no validator catches it, and 600 frames against a stub canvas reported a clean pass — **only looking at it caught it.** Then measuring showed it was not a one-off: **6 of 9 generated sketches leave state dirty** (five `transform`, two `globalCompositeOperation`, one `globalAlpha`). Strengthening the prompt's save/restore rule did **not** help — round one leaked 2 of 4 under the old rule, round two leaked 4 of 5 under the new one. `display.js` now resets compositing, alpha, filter, dash and transform before every frame. Keep that reset; the prompt cannot be trusted to replace it. This generalises: for a hazard this cheap to defend against in the harness, defend in the harness.

**A hidden Browser pane freezes `requestAnimationFrame`.** Screenshots keep returning the last painted frame, so an animated canvas looks like broken code — an all-black wall with zero draw calls. This produced a wrong diagnosis until a freshly-registered `rAF` in the page also reported zero frames in a second, which is the tell: the tab reports `visibilityState: "visible"` the whole time. If a canvas looks dead, check frames before reading code.

**A bogus join code is not a valid WebSocket probe.** The relay closes unknown rooms *before* accepting the socket, and a pre-accept close cannot carry a close code — there's no connection to send a frame over. The browser reports a bare `1006`, indistinguishable at a glance from a transport failure, and it reproduces identically on a known-good server. This produced two wrong diagnoses in a row. Probe with a **real** room, or with `curl -i -H "Connection: Upgrade" -H "Upgrade: websocket" …` and read the status line.

**The Vercel proxy 404s WebSocket upgrades.** It does not forward them. The same upgrade returns `101 Switching Protocols` straight at Cloud Run and `404 Not Found` (`Server: Vercel`) through the domain. The fix needed no infrastructure: pages ask `/api/thecommons/config` where the relay lives and dial Cloud Run directly, which browsers permit — WebSockets aren't subject to CORS preflight, and the relay never had an origin check, since a join code is the capability either way. `SYNTH_WS_ORIGIN` unset means same-origin, so local installs are unaffected and the setting becomes removable if the domain ever moves to the ALB + serverless NEG path the runbook anticipates for Veo.

**The suite checkout is never on `main`, and carries work you must not disturb.** As of 2026-09-17 it sits on `commons/stage-2-room-isolation` (18 commits ahead of `main`, 7 behind) and still holds uncommitted edits to `chatroom/server/services/gemini.js`, a file that differs by 600+ lines between branches. Switching branches in that checkout would fail or endanger that work, so **always use `git worktree`** — `commons/room-state-events` was built that way, at `C:\Users\Alexander\Projects\synthograsizer-commons-state`. Anything branched from a feature branch must be cherry-picked onto `main` rather than merged, or unrelated in-progress work ships with it.

**The test suite's fake pool matches SQL by substring.** A syntax error or a wrong column name passes every test and only fails in production. That's why the schema and all runtime SQL were additionally parsed against the real PostgreSQL grammar (`pglast`/libpg_query) with every INSERT/UPDATE column cross-checked against the parsed schema. Keep doing that when SQL changes.

**Tests can silently hit the real Gemini key.** The end-to-end isolation test drove live HTTP through the real generator without stubbing `ai_manager.genai_client`, and this machine has a real key configured — so it was making **actual billed calls**, taking 2+ minutes. Anything driving the router over HTTP must force `genai_client` to `None` or stub `google_api.gen_text`.

**Environment notes.** The dev machine has no Docker and no Postgres, and no self-contained Postgres exists on PyPI for Windows — hence the in-memory dev harness. `pytest` is used throughout `tests/` but is **not in `requirements.txt`**; it must be installed manually.

---

## Invariants

- Fresh generation produces native Canvas2D JavaScript in `code`; inherited p5.js instance-mode pieces use `p5Code`. **Never merge these contracts** or rewrite the inherited library. The `room` data reaches p5 through host functions for exactly this reason.
- Generate executable drawing code only. Never add image or video generation.
- Preserve create-vs-remix, compatible settings, stale-source rejection, durable undo, fallback visibility, and job idempotency.
- Preserve automatic balanced control assignment, four-second shared turns, and the 30-second disconnect grace — per room.
- `room.state` stays display-local and ephemeral. Persisting or syncing it would break sketches that store functions in it, and would put 60fps game state through the relay.
- `share` stays trigger-only, and a sketch always keeps at least one assignable control — the room must never stop being something people own a piece of.
- Reset leaked canvas state every frame in the harness. Do not rely on generated code to clean up after itself; measurement says it does not.
- Keep tests off paid providers and production data.
- Keep credentials, local jobs, QR output, and `.commons-data/` private.

---

## Repositories

**`TheCommons`** (this repo) — <https://github.com/quitters/TheCommons>, at `C:\Users\Alexander\Projects\agents-everywhere-hackathon\repos\TheCommons`. The standalone Node app, still runnable locally (`npm start`, then `http://127.0.0.1:4188`). `npm run verify` before any change here. `docs/PRESENTATION_TRANSCRIPT.md` and `docs/QA_PREP.md` remain deliberately untracked; the Q&A overlaps README and has stale claims about persistence, template authorship, and capacity.

**`synthograsizer-suite`** — <https://github.com/quitters/synthograsizer.git>, at `C:\Users\Alexander\Projects\synthograsizer-suite` (directory name differs from the repo name). Where the hosted product lives. `python -m pytest tests/ -q` — **394 passing** on `commons/room-state-events`, 360 on deployed `main`; ~10s, no network. The `room` branch was built in a worktree at `C:\Users\Alexander\Projects\synthograsizer-commons-state`.

Old `trycloudflare.com` URLs and the laptop gateway are expired demo artifacts, not deployment addresses. The production milestone — a stable URL that works with the development laptop off — is met.
