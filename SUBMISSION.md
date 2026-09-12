# Submission checklist

Adapted from the [Agents, Everywhere starter kit](https://github.com/CopilotKit/agents-everywhere-starter-kit)'s own `SUBMISSION.md` template. Check your city's participant portal for the actual deadline and any local rule updates — do not assume this file's dates or defaults are final.

## Build eligibility

- [x] This project is a net-new build created during the official hackathon period
- [x] Its core functionality was built during the event — see "What's inherited vs. built" in [README.md](README.md) for the honest split
- [x] Inherited templates, libraries, prompts, components, and starter code are identified separately from event work

**What we inherited**
- 31 real p5.js generative-art template files, copied verbatim from a sibling project (`synthograsizer-suite`)'s own template library — see [README.md#whats-inherited-vs-built](README.md#whats-inherited-vs-built) for the full list and reasoning. Several of the templates themselves credit further upstream open generative-art sources in their own `tags` field.
- The general *idea* of "a single prompt generates a knob-controllable creative-coding sketch" — inspired by that same sibling project's own prompt-to-template feature, but reimplemented from scratch for this project's own contract (native Canvas2D, not p5) and never sharing code with it.

**What we built during the hackathon**
- The WebSocket relay and its soft per-variable ownership model (`server/relay.js`)
- The Facilitator agent — the perceive/decide/act loop that autonomously evolves the piece from room telemetry (`server/facilitator.js`)
- Prompt-to-native-sketch generation and its system prompt, with automatic fallback across the full built-in pool on any failure (`server/generate.js`)
- The p5.js adapter that lets the inherited template library run inside this project's shared multi-station system at all — those templates were never wired to a shared relay/display before (`client/display/display.js`)
- Live microphone audio analysis and the audio-reactivity contract (`client/display/display.js`)
- The table station UI — on-screen knobs generated generically from whatever sketch is live, plus the full-remix prompt box (`client/station`)
- The smoke test suite (`server/smoke-test.js`)

## Title and description

**What you built**
<!-- TODO (team): one or two sentences on the complete interaction the demo shows. -->

**Who it is for**
<!-- TODO (team): name a person in a concrete situation -- e.g. "a bar/venue that wants a shared visual piece the whole room shapes together, not a screen nobody's watching." -->

**Why the context matters**
The agent (the Facilitator) only has anything to perceive or decide because more than one person's hands are in the piece at once, in a physical room, with real telemetry about who's engaged and who's gone quiet. Remove the room and there's nothing left for it to watch.

**Sponsor technologies used**
<!-- TODO (team): name the ones actually used and what they visibly contributed. As of this pass: OpenAI (prompt-to-sketch generation, optional -- the app runs fully without a key). Confirm before submitting which others, if any, ended up wired in. -->

## Evidence for the judging criteria

| Official criterion | Where to show it |
|---|---|
| Core Requirements & Functionality | Boot with zero config (`npm start`, no API key) and show the full loop live: a knob press on one device changes the shared display on another, in real time. |
| Innovation & Theme Alignment | Show the surface itself — multiple phones/laptops as table stations plus a shared display — before touching a knob. Then state plainly what's lost if it's one person on one screen: everything, since no single person's input alone produces "many hands." |
| Technical Execution & Integration | Demonstrate a real failure path: a generation call with no API key (falls back automatically, see `server/generate.js`), or a table's WebSocket dropping mid-session (the display keeps running on the last known state). |
| Usefulness & Agentic Experience | Let the Facilitator autonomously regenerate the piece after a quiet stretch, on camera, with no one touching a keyboard — then explain what work that saves (nobody has to run or babysit the installation). |

- [ ] We can point to visible evidence for every criterion above
- [ ] We distinguish live behavior (the relay, the Facilitator, real generation) from the built-in fallback pool, on camera
- [ ] Sponsor technologies contribute to the workflow; their count is not itself a judging criterion

## Public repository

- [x] A new participant can run the quickstart from a clean clone (`npm install && cp .env.example .env && npm start` — verified working with zero configuration)
- [x] The README lists the credentials and separate processes required (just `OPENAI_API_KEY`, optional)
- [x] `npm run verify` passes (`server/smoke-test.js` — boots the real server on a test port, forces the no-key fallback path, checks the template library, the fallback pool, and the live `/api/telemetry`/`/api/generate` endpoints; run and confirmed passing 2026-09-12)
- [x] `.env` is gitignored; no tokens or account secrets are committed
- [x] Sample/fallback content is clearly labeled as such (the built-in sketch pool, the `fallback: true` flag in generation responses)

## Two-minute demo video

- [ ] Show the surface (multiple stations + shared display) before the first knob press
- [ ] Demonstrate one complete interaction: a knob turn on one device visibly changing the shared canvas
- [ ] Show a visible result: the display actually changing, not just a station's own screen
- [ ] Show the Facilitator acting autonomously at least once (may need to wait out the 90s idle window, or temporarily lower `EVOLVE_AFTER_IDLE_MS` in `server/facilitator.js` for the recording)
- [ ] State which sponsor technologies made the interaction possible
- [ ] Keep the video within the event's limit and check audio

<!-- TODO (team): record after the above is confirmed working end-to-end on the actual demo hardware/network, not just localhost. -->

## Social post and final submission

- [ ] Follow the organizer's posting and sponsor-tagging instructions (check the Ottawa participant portal specifically — this file's defaults are adapted from the starter kit's own SF-oriented template)
- [ ] Link the public repository and video
- [ ] Credit the sponsors actually used
- [ ] Check the live integration once more before recording or submitting
- [ ] Inspect the repository, video, and screenshots for secrets (`.env` values, API keys visible in a terminal window, etc.)

Prepared for a human to fill in the TODOs and publish — nothing above submits or posts on its own.
