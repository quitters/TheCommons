# The Commons

A shared generative-art canvas on the wall — many hands, one evolving piece, nobody controls it alone. Built for **Agents, Everywhere** (Ottawa, September 2026). The engine — relay, facilitator agent, prompt-to-code generation, station UI, and an optional audio-sync layer — is written entirely from scratch. The default sketch library is honestly inherited: 28 real p5.js templates from `synthograsizer-suite`'s own template set, used verbatim as content, which is explicitly permitted ("existing templates... may be used as building blocks") rather than something this project is quietly passing off as new. See "What's inherited vs. built" below.

See [SUBMISSION.md](SUBMISSION.md) for the hackathon eligibility/deliverables checklist, [LICENSE](LICENSE) for terms (MIT, with the inherited template content separately noted), and [AGENTS.md](AGENTS.md) if you're a coding agent picking this up cold — it has the specific, hard-won gotchas that aren't obvious from reading the code once.

Visual identity — palette, type, layout logic — was designed once in [pitch.html](pitch.html) and shared into the actual product via [client/shared/theme.css](client/shared/theme.css). Extend that, don't invent a second visual language for the app itself.

Post-hackathon direction: a tool at `synthograsizer.com/thecommons`, integrated into `synthograsizer-suite` and hosted through the site's existing Google Cloud stack, where creators own separate rooms with unique displays and participant QR codes. This is planned, not built. See [docs/HANDOFF.md](docs/HANDOFF.md) for the verified generation-repair status, open infrastructure decisions, and phased next steps.

## What this is, on purpose

- **Many hands, one canvas.** Any number of "table stations" (a phone, tablet, or laptop each) push knob changes to a shared display over WebSocket. Nobody controls the piece alone — the core use case is exactly what it sounds like at a bar or venue: everyone in the room has a little bit of pull over what's on the wall.
- **Code-based generative art only.** Every sketch — freshly generated or from the default library — is JavaScript drawing code, run directly in the browser. No image-generation or video-generation model is called anywhere in this codebase, ever. That's a scope decision, not a missing feature.
- **Optionally synced to live music.** The display page can analyse this machine's microphone input (bass/mid/treble energy + a simple onset heuristic) and pass that into a sketch's drawing code each frame, so the piece can visibly react to whatever is playing in the room. This is a layer on top of the core interaction, not a requirement — the many-hands mechanic is the whole point even in total silence.
- **An actual agent, not just a networked toy.** A facilitator process watches aggregate engagement across every table — which knobs are hot, which tables have gone quiet, how long since the piece last meaningfully changed — and autonomously decides when to regenerate the piece, so it stays alive over an evening without an operator running it.

## Quickstart

Requires Node.js 20.6 or newer and npm. For a fresh clone:

```bash
git clone https://github.com/quitters/TheCommons.git
cd TheCommons
npm install
cp .env.example .env
npm run verify
npm start
```

In Windows PowerShell, use `Copy-Item .env.example .env` instead of `cp`. Copy the example only on first setup; preserve an existing `.env`. The example uses port **4173**; if you change `PORT`, use that port in every local URL (the event laptop uses 4188).

Then open:
- **`http://127.0.0.1:4173/display/`** — put this on the shared screen/projector. Choose **Enable microphone** for optional audio reactivity, or **Just watch** to dismiss the card. Sound can be enabled later from the corner button.
- **`http://127.0.0.1:4173/station/?table=1`** — one tab per table. Open it again with `?table=2`, `?table=3`, etc. to simulate multiple tables on one machine for testing. Phones on the same network should use this machine's LAN IP instead of `127.0.0.1`.

Participants can simply open `/station/`: table labels are optional, and each participant receives an identity automatically. Use `127.0.0.1` for local browser tabs; see [AGENTS.md](AGENTS.md) for the IPv4 connection gotcha.

On the display, **Hide overlays · F** removes the logo, status, invitation QR, and sound controls for a clean canvas. Press **F** again, press **Escape**, or click/tap the artwork to restore them. The animation and microphone keep running, and existing panel states are preserved.

Without a model key, the server runs entirely on the built-in pool — two hand-written sketches (`server/builtin-sketches.js`) plus the inherited library (`templates/`, loaded by `server/templates.js`; 28 files preserved, one unsupported renderer excluded). No OpenAI key is required. Set `GENERATION_PROVIDER=fallback` to guarantee no model calls even with keys configured.

## Creator desk and shared controls

The **creator/admin** remixes at **`http://127.0.0.1:4173/admin/`**, after signing in with `ADMIN_PASSWORD` from `.env`. Set your own password locally; a blank password disables access. Participant stations cannot generate or read generation jobs, including through direct API calls. Each participant receives controls automatically. When people outnumber variables, controls are shared in balanced groups with four-second turns. Reloading a station preserves its identity; a disconnected participant keeps their allocation for 30 seconds. A remix rebuilds everyone's controls from the new variables, including changed names, types, ranges, choices, and defaults.

Choose **Remix this piece** to send the current code, variable definitions, and settings with a change request, or **Create a new piece** to generate from a fresh prompt alone. Remix snapshots its source when the job starts, retains compatible control values, and rejects a request based on an outdated piece. Inherited p5 sources are references for a new native Canvas2D result; their files and runtime contract remain untouched. **Undo last change** restores the preceding sketch and its saved settings without another model call, including after a server restart. Undo is unavailable during generation. API clients default to `mode: "create"`; the async endpoint also accepts `mode: "remix"` and `baseSketchId`.

For the final rehearsal, use [docs/DEMO_RUNBOOK.md](docs/DEMO_RUNBOOK.md).

The optional **Choose a preset** panel lists previous successful generations, named saved looks, two native built-ins, and the supported inherited library. **Save current look** stores the current piece and settings for an event set. Loading a preset makes no model call, updates all participants, and supports undo. The unsupported SVG template remains excluded. Presets and generated pieces stay in the ignored local data directory, not in `templates/`.

## Invite an audience

For a temporary audience link, `npm run preview:public` starts a separate gateway at `127.0.0.1:4189` (override `PUBLIC_PREVIEW_PORT`). It reads the app's `PORT` from `.env`. Point a separately approved tunnel at this gateway, **not at the main app port**. It exposes only station/display/shared assets and WebSockets; admin and generation routes are blocked. Keep the creator desk on the main local address. Keep the laptop awake and all three processes running: app, gateway, and tunnel. A temporary tunnel is not a permanent deployment.

After starting an approved Cloudflare Quick Tunnel, generate a scan-to-join code for its current station URL:

```bash
cloudflared tunnel --url http://127.0.0.1:4189
# In another terminal, substitute the address printed by cloudflared:
npm run qr -- https://YOUR-CURRENT-TUNNEL.trycloudflare.com/station/
```

The QR appears on the shared display and under **Invite participants** in the creator desk. Open `/shared/join.html` for a large presentation view, or download `/shared/join-qr.png` for printing. Encoding and verification run locally, without an external QR service. Regenerate whenever the tunnel URL changes; open pages update within ten seconds. Generated QR assets and the event URL are ignored by Git.

Test a real phone on mobile data before presenting. Restarting the tunnel changes its address; restarting the app requires connected stations to reload. See [docs/DEMO_RUNBOOK.md](docs/DEMO_RUNBOOK.md) for rehearsal and [docs/OPERATIONS.md](docs/OPERATIONS.md) for access boundaries and private data.

## Gemini and saved generation jobs

For live Gemini generation, set `GENERATION_PROVIDER=gemini` and either `GEMINI_API_KEY` or `GEMINI_CONFIG_PATH` to an existing server-local JSON file containing `api_key`. The default model is `gemini-3.1-pro-preview`; the key stays on the server. OpenAI remains available with `GENERATION_PROVIDER=openai` and `OPENAI_API_KEY`. Set `FACILITATOR_ENABLED=false` for manual remixes only; enabling it permits autonomous model calls.

The creator desk starts a saved background job and polls it. Gemini gets a ten-minute deadline (`GEMINI_TIMEOUT_MS`), independent of browser requests. Reloads and lost responses reuse the same job ID without another model call. Prompts and finished sketches are saved under ignored `.commons-data/generations/` (override with `GENERATION_DATA_DIR`); completed applied sketches return after a server restart. A server restart interrupts an unfinished model request, but preserves its prompt and marks it for an explicit retry. A model timeout uses the fallback pool and retains the idea; partial provider output cannot be resumed. Invalid JSON, schema, or JavaScript syntax triggers one additional paid repair call containing the original response and exact validation error. If repair fails, the fallback pool remains available. Network, HTTP, and timeout failures fall back immediately without repair. Deadlines apply per provider call, so a repaired job can take up to two call deadlines; reloads never repeat a paid request.

Run `npm run verify` (or `npm test`) to check this yourself — it boots the real server on a separate test port with the key forced empty, then exercises the template library, the fallback pool, and the live `/api/telemetry` and `/api/generate` endpoints (`server/smoke-test.js`).

| Command | Purpose |
|---|---|
| `npm start` | Run the app using local `.env` settings. |
| `npm run dev` | Restart automatically when server files change; use outside the live demo. |
| `npm run verify` | Run isolated server/API checks with paid generation disabled. |
| `npm run preview:public` | Start the audience-only gateway; does not itself open a public tunnel. |
| `npm run qr -- <station-url>` | Generate and independently decode-check the local invitation QR. |

The lockfile pins the tested dependency set. `qs` is overridden to 6.16.0 to address the query-parser advisories reported against Express 4's dependency range; review this override when updating Express. Use `npm ci` for a reproducible install and `npm audit` to check current dependency advisories.

## How a sketch works

Two contracts, documented in [`shared/contract.js`](shared/contract.js) and run through entirely separate paths in [`client/display/display.js`](client/display/display.js):

- **Native** — `{ name, promptTemplate, variables[], code }`, where `code` is JavaScript executed every frame as `(ctx, frame, getVar, audio) => { ...code... }` on the native Canvas2D API. This is the *only* contract anything is ever freshly generated into — `server/generate.js`'s system prompt asks for nothing else.
- **Inherited p5** — `{ name, promptTemplate, variables[], p5Code }`, where `p5Code` is real p5.js instance-mode code (`p.setup`/`p.draw`), run through a loaded `p5.js` library with `p.getSynthVar(name)` wired to the same live knob state as `getVar` above. This is the contract the default template library already existed in — nothing here was rewritten to fit a new shape.

Either way, `getVar`/`p.getSynthVar` reads the current knob value for a variable; on the native path, `audio.bass`/`audio.beat`/etc. additionally carry the live music-reactivity signal (the inherited templates predate that idea and don't consume it yet — see next-steps below).

## What's built vs. what's a documented next step

**Built and working:**
- Server: Express + a WebSocket relay (`server/relay.js`) with automatically balanced individual assignments and shared groups when people outnumber controls. Opaque per-tab session tokens preserve assignments on reload; table labels do not grant ownership. Shared changes hold for four seconds so a turn is visibly legible, without averaging inputs.
- Generation (`server/generate.js`): prompt → Gemini or OpenAI → validated native JSON, with automatic fallback on missing keys, invalid output, or network errors. Admin-only background jobs preserve prompts/results across browser reloads and prevent duplicate generation requests.
- Fresh-generation checks (`server/validate-sketch.js`): native-only output, 2–16 named controls, matching prompt placeholders, and compilable JavaScript before broadcast. Categorical controls have 3–10 distinct weighted choices; explicitly numeric controls have finite min/max/step/default values. Gemini defaults to a ten-minute deadline; OpenAI to 45 seconds. Syntax validation does not execute model code on the server or guarantee visual quality; the display still handles per-frame runtime errors.
- Default template library (`server/templates.js`): loads and normalizes 28 real p5.js templates at boot, excluding one (`svg-flow-particles`) that uses a renderer mode this project doesn't special-case yet.
- Facilitator agent (`server/facilitator.js`): when enabled, polls every 10s and after 90s of room-wide silence regenerates from engagement history. One call at a time, with a fresh 90-second cooldown after completion; a stale result cannot replace a newer admin remix.
- Display (`client/display`): runs either sketch contract, live mic analysis, graceful per-frame error handling on the native path (one bad frame from a malformed sketch never kills the animation loop).
- Station (`client/station`): renders assigned controls generically. Quantities explicitly declared as numbers get sliders with min/max/step labels and a live readout; categories retain selectable buttons. Numeric-looking text is never silently converted. Inherited template content remains unchanged.
- Shared state: all open stations receive remixes, assignments, and accepted changes; late stations and displays join with current values. A shared turn blocked by another person's hold restores the accepted value with an explanation. Remixes clear pending slider changes, rebuild controls, and redistribute the new variables automatically.
- Visual identity (`client/shared/theme.css`): both `client/station` and `client/display` now share the same palette/type/layout language `pitch.html` established, instead of the bare functional styling they launched with.
- Smoke test (`server/smoke-test.js`, `npm run verify`): boots the real server, forces the no-key fallback path, and checks the template library, the fallback pool, and the live API endpoints. No test framework dependency.

**Documented, not yet built:**
- Physical MIDI controller support (Web MIDI API) as an alternative to touch knobs at a table. Touch knobs are the practical default for a hackathon demo — they work on any device with zero hardware sourcing — but the relay/station split is designed so a MIDI-reading station is a drop-in addition, not a redesign.
- A visible on-screen nudge from the facilitator to a specific quiet table (currently it only ever triggers a full-room regeneration, not a per-table hint).
- Audio-reactivity for the inherited p5 template library — today only natively-generated sketches consume `audio.*`; wiring a few of the strongest inherited templates (e.g. `flow-field`, `strange-attractors`) to react to `p.getSynthVar('_audio_bass')`-style live values would extend the music-sync story across the whole default library, not just fresh generations.
- **Multiple rooms and short join codes**: QR joining works today for the single shared room. A future `/join` page could accept a short room code and route participants to separate canvases; the server currently hosts one room.

## What's inherited vs. built

Per the hackathon's own eligibility rules ("existing templates... may be used as building blocks," but "the project's core functionality must be built during the event"):

- **Inherited, unmodified, clearly attributed:** the 28 files in [`templates/`](templates/) — real p5.js generative-art templates copied verbatim from `synthograsizer-suite`'s own template library (several of which credit their own further upstream sources in each file's own `tags` field). This is default *content*, not the mechanism. The schema those files follow, and the actual prompt that generated them, are documented (trimmed to only the parts relevant here) in [`docs/TEMPLATE_SCHEMA.md`](docs/TEMPLATE_SCHEMA.md) and [`docs/inherited-p5-generation-prompt.md`](docs/inherited-p5-generation-prompt.md) — neither is wired into this project's own generation path (see "How a sketch works" above), they're there so the inherited content's origin is fully traceable, not just the content itself. Three templates from the original set (`glorpy_heads`, `smiley-mound`, `salvagepunk-salon`) were dropped rather than adapted: most of their declared knobs were leftover text-to-image prompt fragments from the sibling project's original two-stage pipeline (p5 wireframe → img2img refinement) that this project's p5 code never reads, so they'd have handed participants controls that visibly did nothing.
- **Built from scratch during the event:** everything that makes this a shared, agentic, music-synced installation rather than a single-user art tool — the WebSocket relay and its individual/shared assignments, the facilitator's perceive/decide/act loop, the prompt-to-native-code generation path and its system prompt, the live audio analysis, the station UI, and the p5-adapter that lets the inherited templates run inside this project's own knob/relay system at all (they were never wired to a shared multi-station display before).

This project does not call into, vendor, or fork any *code* from `synthograsizer-suite` or `SignalChain` (sibling projects on the same machine) — only the explicitly-permitted template *content* above, copied once, unmodified, and disclosed here rather than blended in quietly.

## FAQ

**Is the generated code p5.js?** No. Anything freshly generated is plain Canvas2D JavaScript — a function body taking `(ctx, frame, getVar, audio)`, no libraries, no imports. p5.js is loaded only to run the 28 inherited templates, through an entirely separate path (see "How a sketch works" above); the two contracts never mix, by design.

**Why Canvas2D instead of having the model write p5 too?** A smaller, more reliable target for a model to get right on the first try, live, with a room waiting — no setup/draw lifecycle or library quirks to get wrong, just one function that draws a frame from scratch every time.

**Is it safe to run AI-written code on a public display?** Two real layers, with an honest limit. Before broadcast, the server checks structure — valid control types, numeric ranges, unique names — and compiles the code (never executes it server-side) to catch syntax errors. On the display, a runtime error in one frame is caught and swallowed so one bad frame never kills the animation loop. What this does *not* do is sandbox the code against a deliberately malicious script (no worker/iframe isolation) — an acceptable boundary here because only the signed-in admin can trigger generation at all; participants never submit code or prompts.

**What happens if generation fails or times out?** Invalid JSON, schema, or JavaScript syntax gets one validation-aware repair call. If repair also fails, or a network, HTTP, or timeout error occurs, generation falls back to the two native built-ins and 27 supported inherited templates. A fallback may look unrelated to the requested idea.

**Can a remix build on the current piece, or does it always start over?** Both, as separate admin actions: "Remix this piece" sends the current code, variables, and settings as context; "Create a new piece" sends only the new prompt. "Undo last change" reverts without another model call.

**How does the app decide who controls what?** Automatically, on join. With at least as many controls as people, everyone gets their own; with more people than controls, a control is shared by a small group and each person's turn holds for four seconds before it can be taken, so a turn is visibly legible rather than a race.

**What happens if two people reach for the same shared control at once?** Whoever's turn it currently is keeps it until the hold expires; the other person's station reports that it's held and by whom. Nothing is silently dropped or averaged.

**What if someone joins or leaves mid-piece?** Controls rebalance automatically — leaving frees a slice for someone else, joining takes a fair share from whoever currently has more than one. A 30-second disconnect grace period means a dropped connection doesn't immediately reassign someone's controls.

**Where's the actual agent?** The facilitator (`server/facilitator.js`): it watches real aggregate engagement — which tables are active, which have gone quiet, how long since the piece last meaningfully changed — and after 90 seconds of room-wide silence, autonomously calls the same generation path a person's own prompt would use. It's off by default in this repo's `.env` (`FACILITATOR_ENABLED=false`); enabling it is a config flag, not a missing feature.

**What's the stack?** Node.js, Express, and the `ws` WebSocket library — no frontend framework, no build step. State lives in server memory; there's no database, because nothing here needs to outlive one running session.

**Does this scale to a real venue?** The shared-control mechanic exists exactly for this: it assumes more people than knobs from the start rather than one phone per control. The practical ceiling is the WebSocket server's own connection limit, comfortably in the hundreds on a single machine.

**Are the built-in visuals themselves AI-generated?** No — the 28 default templates are hand-written p5.js sketches from a sibling project, used verbatim and disclosed above. Only what an admin's own prompt produces is model-written, and only ever as drawing code, never an image or video.

**Why no image or video generation, given tools like that exist?** That's this project's actual premise: AI-generated video delivered for a client event got rejected for feeling cold and impersonal in a room meant to be about people connecting with each other. So this only ever generates code that draws, steered by the room itself — never a finished clip handed to people to just watch.

**Can a participant type something inappropriate into a prompt?** No — only the signed-in admin can submit a generation prompt at all. Participants adjust existing knobs; they never send text that reaches a model.

**Is any personal data collected?** No accounts and no names — a random per-tab session token, held only in the participant's own browser for the length of the event, is the only identifier.
