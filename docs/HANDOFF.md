# The Commons — development handoff

Updated: 2026-09-17.

**The Commons is live in production** at <https://synthograsizer.com/thecommons>, hosted inside the Synthograsizer suite. Any signed-in Synthograsizer account can create a room, generate art into it with Gemini, put the wall on a screen, and let people scan a QR to take a control. This document describes the deployed system, how to deploy it again, what is and isn't verified, and what's left.

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

**Not verified at all:**

- **Real phones.** Everything so far has been desktop browsers. The QR has never actually been scanned.
- **Load.** No measurement of simultaneous rooms, participants per room, update rates, latency, or memory. Publish measured capacity, never assumptions.
- **Long sessions and reconnects** under real conditions, including the Cloud Run 600s request timeout against long-lived sockets.
- **Restart behavior** with live participants attached.

---

## What's left, roughly in priority order

1. **Invitation lifecycle.** A join code, once issued, works forever. There is no close, reopen, expire, or rotate — and no UI for any of it. The `status` column and the 4404/404 paths exist and are honored; nothing sets them.
2. **Untrusted-creator sandboxing.** Generated drawing code still runs on the **same origin as the signed-in page**. That is acceptable while creators are the owner and people he trusts; it is the thing to close before opening room creation to the public. A sandboxed frame on a separate origin with a narrow validated message interface is the shape.
3. **Durable job recovery.** A job interrupted by a restart is marked `interrupted` and never resumed. Provider-outcome uncertainty isn't recorded for explicit recovery either.
4. **Multi-instance.** The relay registry is in-process, which is only safe because the service is pinned to `--min-instances 1 --max-instances 1`. Scaling past one instance needs shared relay state *and* shared rate-limit/budget state first — the suite's own runbook says the same.
5. **Real-phone and load testing** (above).
6. **Facilitator.** Still disabled. Needs per-room opt-in, consent, and its own reserve/commit/refund wiring before it can autonomously spend.

---

## Traps worth knowing

These each cost real time. They are not obvious from the code.

**A bogus join code is not a valid WebSocket probe.** The relay closes unknown rooms *before* accepting the socket, and a pre-accept close cannot carry a close code — there's no connection to send a frame over. The browser reports a bare `1006`, indistinguishable at a glance from a transport failure, and it reproduces identically on a known-good server. This produced two wrong diagnoses in a row. Probe with a **real** room, or with `curl -i -H "Connection: Upgrade" -H "Upgrade: websocket" …` and read the status line.

**The Vercel proxy 404s WebSocket upgrades.** It does not forward them. The same upgrade returns `101 Switching Protocols` straight at Cloud Run and `404 Not Found` (`Server: Vercel`) through the domain. The fix needed no infrastructure: pages ask `/api/thecommons/config` where the relay lives and dial Cloud Run directly, which browsers permit — WebSockets aren't subject to CORS preflight, and the relay never had an origin check, since a join code is the capability either way. `SYNTH_WS_ORIGIN` unset means same-origin, so local installs are unaffected and the setting becomes removable if the domain ever moves to the ALB + serverless NEG path the runbook anticipates for Veo.

**The suite checkout sits on a ChatRoom feature branch.** `chatroom/gemini-modernization-phases-0-1` is 11 commits ahead of `main` with unrelated in-progress work, and carries uncommitted edits to `chatroom/server/services/gemini.js` that differ by 600+ lines between branches. Anything branched from it must be **cherry-picked onto `main`**, and you must use `git worktree` rather than switching branches in that checkout — a checkout would fail or endanger that work.

**The test suite's fake pool matches SQL by substring.** A syntax error or a wrong column name passes every test and only fails in production. That's why the schema and all runtime SQL were additionally parsed against the real PostgreSQL grammar (`pglast`/libpg_query) with every INSERT/UPDATE column cross-checked against the parsed schema. Keep doing that when SQL changes.

**Tests can silently hit the real Gemini key.** The end-to-end isolation test drove live HTTP through the real generator without stubbing `ai_manager.genai_client`, and this machine has a real key configured — so it was making **actual billed calls**, taking 2+ minutes. Anything driving the router over HTTP must force `genai_client` to `None` or stub `google_api.gen_text`.

**Environment notes.** The dev machine has no Docker and no Postgres, and no self-contained Postgres exists on PyPI for Windows — hence the in-memory dev harness. `pytest` is used throughout `tests/` but is **not in `requirements.txt`**; it must be installed manually.

---

## Invariants

- Fresh generation produces native Canvas2D JavaScript in `code`; inherited p5.js instance-mode pieces use `p5Code`. **Never merge these contracts** or rewrite the inherited library.
- Generate executable drawing code only. Never add image or video generation.
- Preserve create-vs-remix, compatible settings, stale-source rejection, durable undo, fallback visibility, and job idempotency.
- Preserve automatic balanced control assignment, four-second shared turns, and the 30-second disconnect grace — per room.
- Keep tests off paid providers and production data.
- Keep credentials, local jobs, QR output, and `.commons-data/` private.

---

## Repositories

**`TheCommons`** (this repo) — <https://github.com/quitters/TheCommons>, at `C:\Users\Alexander\Projects\agents-everywhere-hackathon\repos\TheCommons`. The standalone Node app, still runnable locally (`npm start`, then `http://127.0.0.1:4188`). `npm run verify` before any change here. `docs/PRESENTATION_TRANSCRIPT.md` and `docs/QA_PREP.md` remain deliberately untracked; the Q&A overlaps README and has stale claims about persistence, template authorship, and capacity.

**`synthograsizer-suite`** — <https://github.com/quitters/synthograsizer.git>, at `C:\Users\Alexander\Projects\synthograsizer-suite` (directory name differs from the repo name). Where the hosted product lives. `python -m pytest tests/ -q` — **360 passing**, ~8s, no network.

Old `trycloudflare.com` URLs and the laptop gateway are expired demo artifacts, not deployment addresses. The production milestone — a stable URL that works with the development laptop off — is met.
