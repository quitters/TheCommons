# The Commons

A shared generative-art canvas on the wall — many hands, one evolving piece, nobody controls it alone. Built for **Agents, Everywhere** (Ottawa, September 2026). The engine — relay, facilitator agent, prompt-to-code generation, station UI, and an optional audio-sync layer — is written entirely from scratch. The default sketch library is honestly inherited: 31 real p5.js templates from `synthograsizer-suite`'s own template set, used verbatim as content, which is explicitly permitted ("existing templates... may be used as building blocks") rather than something this project is quietly passing off as new. See "What's inherited vs. built" below.

See [SUBMISSION.md](SUBMISSION.md) for the hackathon eligibility/deliverables checklist, and [LICENSE](LICENSE) for terms (MIT, with the inherited template content separately noted).

## What this is, on purpose

- **Many hands, one canvas.** Any number of "table stations" (a phone, tablet, or laptop each) push knob changes to a shared display over WebSocket. Nobody controls the piece alone — the core use case is exactly what it sounds like at a bar or venue: everyone in the room has a little bit of pull over what's on the wall.
- **Code-based generative art only.** Every sketch — freshly generated or from the default library — is JavaScript drawing code, run directly in the browser. No image-generation or video-generation model is called anywhere in this codebase, ever. That's a scope decision, not a missing feature.
- **Optionally synced to live music.** The display page can analyse this machine's microphone input (bass/mid/treble energy + a simple onset heuristic) and pass that into a sketch's drawing code each frame, so the piece can visibly react to whatever is playing in the room. This is a layer on top of the core interaction, not a requirement — the many-hands mechanic is the whole point even in total silence.
- **An actual agent, not just a networked toy.** A facilitator process watches aggregate engagement across every table — which knobs are hot, which tables have gone quiet, how long since the piece last meaningfully changed — and autonomously decides when to regenerate the piece, so it stays alive over an evening without an operator running it.

## Quickstart

```bash
npm install
cp .env.example .env
npm start
```

Then open:
- **`http://localhost:4173/display/`** — put this on the shared screen/projector. Click once to enable microphone-driven audio reactivity (optional; the piece runs fine without it).
- **`http://localhost:4173/station/?table=1`** — one tab per table. Open it again with `?table=2`, `?table=3`, etc. to simulate multiple tables on one machine for testing.

Without an `OPENAI_API_KEY` in `.env`, the server runs entirely on the built-in pool — two hand-written sketches (`server/builtin-sketches.js`) plus the full 31-template default library (`templates/`, loaded by `server/templates.js`) — so the whole pipeline (knobs → relay → display → audio-reactivity) is fully demoable, with real visual variety, before any configuration exists. Add a key to unlock live generation from a text prompt (the station page's "Remix for the room" box) and the autonomous facilitator loop.

Run `npm run verify` (or `npm test`) to check this yourself — it boots the real server on a separate test port with the key forced empty, then exercises the template library, the fallback pool, and the live `/api/telemetry` and `/api/generate` endpoints (`server/smoke-test.js`).

## How a sketch works

Two contracts, documented in [`shared/contract.js`](shared/contract.js) and run through entirely separate paths in [`client/display/display.js`](client/display/display.js):

- **Native** — `{ name, promptTemplate, variables[], code }`, where `code` is JavaScript executed every frame as `(ctx, frame, getVar, audio) => { ...code... }` on the native Canvas2D API. This is the *only* contract anything is ever freshly generated into — `server/generate.js`'s system prompt asks for nothing else.
- **Inherited p5** — `{ name, promptTemplate, variables[], p5Code }`, where `p5Code` is real p5.js instance-mode code (`p.setup`/`p.draw`), run through a loaded `p5.js` library with `p.getSynthVar(name)` wired to the same live knob state as `getVar` above. This is the contract the default template library already existed in — nothing here was rewritten to fit a new shape.

Either way, `getVar`/`p.getSynthVar` reads the current knob value for a variable; on the native path, `audio.bass`/`audio.beat`/etc. additionally carry the live music-reactivity signal (the inherited templates predate that idea and don't consume it yet — see next-steps below).

## What's built vs. what's a documented next step

**Built and working:**
- Server: Express + a WebSocket relay (`server/relay.js`) with soft per-variable ownership (a knob "holds" its variable for a few seconds so a turn is visibly legible, rather than blending multiple simultaneous inputs into an untraceable average).
- Generation (`server/generate.js`): prompt → OpenAI → validated `{name, variables, code}` JSON, with automatic fallback — on a missing key, bad JSON, or network error — to a random pick across the full built-in pool (native + inherited), so a generation hiccup never takes the shared display down to just one or two defaults.
- Default template library (`server/templates.js`): loads and normalizes 31 real p5.js templates at boot, excluding one (`svg-flow-particles`) that uses a renderer mode this project doesn't special-case yet.
- Facilitator agent (`server/facilitator.js`): polls telemetry every 10s, and after 90s of room-wide silence, synthesizes a prompt from which tables were most active earlier and autonomously regenerates the piece.
- Display (`client/display`): runs either sketch contract, live mic analysis, graceful per-frame error handling on the native path (one bad frame from a malformed sketch never kills the animation loop).
- Station (`client/station`): on-screen touch knobs generated generically from whatever the current sketch declares — works identically for native and inherited sketches, no special-casing needed.
- Smoke test (`server/smoke-test.js`, `npm run verify`): boots the real server, forces the no-key fallback path, and checks the template library, the fallback pool, and the live API endpoints. No test framework dependency.

**Documented, not yet built:**
- Physical MIDI controller support (Web MIDI API) as an alternative to touch knobs at a table. Touch knobs are the practical default for a hackathon demo — they work on any device with zero hardware sourcing — but the relay/station split is designed so a MIDI-reading station is a drop-in addition, not a redesign.
- **Per-table microphones, scaling a table's influence by how "chatty" it is** — a genuinely good idea raised mid-build: give each table its own mic input, and let a table's conversational energy (not just its knob presses) scale how much pull it has over its variable, or drive a per-table visual signal directly. Not built this pass; would extend the relay's soft-ownership model (`server/relay.js`) with a per-table audio-energy weight rather than a flat ownership window.
- A visible on-screen nudge from the facilitator to a specific quiet table (currently it only ever triggers a full-room regeneration, not a per-table hint).
- Audio-reactivity for the inherited p5 template library — today only natively-generated sketches consume `audio.*`; wiring a few of the strongest inherited templates (e.g. `flow-field`, `strange-attractors`) to react to `p.getSynthVar('_audio_bass')`-style live values would extend the music-sync story across the whole default library, not just fresh generations.
- **A Jackbox-style join flow**: the shared display shows a short room code; a `/join` page lets someone type it in on their phone rather than navigating to a `?table=N` URL by hand. Better suited to a dim bar than a QR code, which needs a clean line of sight from across a room. Also the honest structural fix if this ever runs more than one room per server — right now a station only makes sense against the one relay it's pointed at.

## What's inherited vs. built

Per the hackathon's own eligibility rules ("existing templates... may be used as building blocks," but "the project's core functionality must be built during the event"):

- **Inherited, unmodified, clearly attributed:** the 31 files in [`templates/`](templates/) — real p5.js generative-art templates copied verbatim from `synthograsizer-suite`'s own template library (several of which credit their own further upstream sources in each file's own `tags` field). This is default *content*, not the mechanism. The schema those files follow, and the actual prompt that generated them, are documented (trimmed to only the parts relevant here) in [`docs/TEMPLATE_SCHEMA.md`](docs/TEMPLATE_SCHEMA.md) and [`docs/inherited-p5-generation-prompt.md`](docs/inherited-p5-generation-prompt.md) — neither is wired into this project's own generation path (see "How a sketch works" above), they're there so the inherited content's origin is fully traceable, not just the content itself.
- **Built from scratch during the event:** everything that makes this a shared, agentic, music-synced installation rather than a single-user art tool — the WebSocket relay and its soft-ownership design, the facilitator's perceive/decide/act loop, the prompt-to-native-code generation path and its system prompt, the live audio analysis, the station UI, and the p5-adapter that lets the inherited templates run inside this project's own knob/relay system at all (they were never wired to a shared multi-station display before).

This project does not call into, vendor, or fork any *code* from `synthograsizer-suite` or `SignalChain` (sibling projects on the same machine) — only the explicitly-permitted template *content* above, copied once, unmodified, and disclosed here rather than blended in quietly.
