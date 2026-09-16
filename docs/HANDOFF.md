# The Commons — development handoff

Updated: 2026-09-16. The hackathon is complete; this is now post-event product work.

## Product direction and current scope

The owner wants The Commons to become a tool on their existing website, hosted through the Google stack they already use. People should be able to create their own rooms and administer them. Each room needs its own display page and a QR code that brings participants into that room's controls. Hosting must operate independently of the owner's laptop and temporary Cloudflare tunnels.

**This direction is recorded, not implemented.** The latest instruction is to document the next steps without building the hosted multi-room product yet. Do not provision infrastructure, deploy, change the website, or start the room refactor merely because this plan exists. Do not push without an explicit request.

The website repository, domain, Google project, existing hosting services, identity system, database, deployment process, and billing constraints have not been established in this task. Discover those first. Do not assume Firebase, Cloud Run, Firestore, or any other particular service is already in use. Reuse the actual stack where appropriate; select services only after checking its configuration and current official documentation.

## Completed generation repair

Two implementation commits were local and unpushed when this handoff was written:

- `c022e7e` — removed `glorpy_heads`, `smiley-mound`, and `salvagepunk-salon`, whose declared controls were mostly unused prompt fragments. There are 28 inherited JSON files; 27 are supported at runtime, with the SVG renderer still excluded.
- `c37fd04` — repair invalid generated sketches before falling back.

The generation change:

- Fresh native sketches accept 2–16 controls; categorical controls accept 3–10 choices.
- Provider requests share `callModel()`. Invalid JSON, schema, or JavaScript syntax receives exactly one repair attempt containing the original output and exact validation error, requesting complete corrected JSON.
- Gemini uses user/model/user conversation turns. OpenAI uses system/user/assistant/user messages. Tests inspect the request bodies, preserved context, original response, and error feedback.
- Network, HTTP, and timeout failures do not trigger repair. An unsuccessful repair still uses the existing fallback pool. Reloads reuse the job rather than starting another paid request.
- OpenAI's output allowance rose from 2,048 to 8,192 tokens to allow larger control definitions alongside drawing code. Gemini remains at 8,192. This gives more headroom; it does not guarantee every requested piece will fit.
- Deadlines apply per call: a repair can add a second paid call and a second call deadline. README, template-schema documentation, agent guidance, and obsolete cap comments were updated.
- Regression tests cover accepting 16 controls/rejecting 17, accepting 10 choices/rejecting 11, successful repair, persistent-invalid fallback, request counts, and oversized remix-source consolidation.

Verification: `git diff --check` and `npm run verify` passed. The initial sandboxed verification hit Windows `spawn EPERM`; rerunning with process permission passed. Verification uses fake provider responses and isolated local test servers, not paid generation. Baseline verification was run again successfully before this documentation update.

### Live check already completed

From the local admin page, **Create a new piece** generated **Stained Glass Observatory** using Gemini `gemini-3.1-pro-preview`. The request explicitly asked for 16 controls and 10 palette choices. The saved job reported `completed`, `applied: true`, `mode: create`, `fallback: false`, 16 controls, 10 palette choices, native `code`, and no `p5Code`. The admin page confirmed publication and the display visibly rendered the drawing.

No repair warning was observed for this live request; successful repair itself was verified with injected responses for both providers. No live OpenAI call was made. The generated result remains in ignored local data. Do not commit it or copy private prompts/data into the website repository.

## Repository and local operating state

- Repository: `C:\Users\Alexander\Projects\agents-everywhere-hackathon\repos\TheCommons`
- Remote: <https://github.com/quitters/TheCommons>
- Branch: `main`. The two implementation commits above precede this handoff documentation. Recheck the actual ahead count rather than assuming it is still two after documentation is committed.
- Presentation drafts remain untracked: `docs/PRESENTATION_TRANSCRIPT.md` and `docs/QA_PREP.md`. They were reviewed and deliberately excluded from the repair commit. The Q&A overlaps README and has stale claims about persistence, template authorship, reconnects, and unmeasured capacity. Keep the files intact; review them separately if publishing presentation materials.
- The app was started at `http://127.0.0.1:4188` for the live check, with Gemini configured privately and the facilitator off. Runtime processes are ephemeral: verify listeners before restarting or stopping anything. Do not terminate unrelated processes.
- No audience gateway or Cloudflare tunnel was started for the check. Old `trycloudflare.com` URLs and the QR pointing to them are expired demo artifacts, not deployment addresses. Preserve the local QR files; do not advertise their old URL.
- `.env`, keys, `GEMINI_CONFIG_PATH` target files, `.commons-data/`, generated jobs, logs, and generated QR assets stay local/private and uncommitted. Never print credentials. Use `127.0.0.1` for local connections.

Before future code changes, read README and AGENTS completely, inspect all working/staged diffs, and run `npm run verify`. For generation/template changes also read `docs/TEMPLATE_SCHEMA.md` and `docs/inherited-p5-generation-prompt.md`. Preserve the user's existing changes.

## Current architecture and gaps

| Area | Current implementation | Required change for hosted rooms |
|---|---|---|
| App wiring | `server/index.js` creates one relay and one job manager | Resolve an explicit room for every room operation |
| Live state | `server/relay.js` has process-local participants, assignments, holds, values, telemetry, and a shared `/ws` endpoint | Isolate state and broadcasts by room; define consistent authority when multiple server instances run |
| Creator access | `server/admin.js` uses one `ADMIN_PASSWORD` and in-memory sessions | Website identity plus server-enforced room ownership; knowing a room ID must not grant admin access |
| Saved work | `server/generation-jobs.js` writes local JSON files, including one `room-state.json` | Durable room-scoped storage, ownership checks, versioning, and job coordination |
| Long-running work | A job runs in the app process and is interrupted by restart | Durable dispatch and recovery appropriate to the selected Google hosting services |
| Client routes | Shared `/admin/`, `/display/`, and `/station/` pages | Room-specific creator, display, and participant routes and room-scoped browser session keys |
| Invitations | `scripts/generate-join-qr.js` writes shared static assets | Derive each room's QR from its canonical hosted participant URL; no global file to overwrite |
| Facilitator | Optional process for the single room | Later: room-specific opt-in, lifecycle, coordination, and spend limits; keep off initially |
| Drawing runtime | Model code runs in the display page; validation checks shape/syntax only | Isolate untrusted executable drawing code before opening room creation to the public |

The local JSON store does preserve completed jobs, presets, and saved sketch/undo state. It is not a shared production database or a continuous record of every knob change. README's older FAQ claims about nothing needing to survive a session, hand-written inherited content, and capacity in the hundreds need a separate factual cleanup before promoting the hosted product. Do not treat those statements as deployment evidence.

## Proposed user journey

1. A creator opens The Commons on the existing website and signs in through its established identity system.
2. The creator creates a room and becomes its owner/admin. They receive a creator desk, a unique display URL, and a participant URL represented as a QR code.
3. A display opens that room's canvas. Participants scan the QR and receive controls for that room, with the current automatic allocation and shared-turn behavior.
4. Only the room owner can generate/remix, load or save looks, undo, and manage the room. Participant access does not confer creator permissions.
5. The owner can close the room and manage access. Define reopening, expiration, retention, and deletion behavior before implementing those actions.

Illustrative routes, subject to the website's routing conventions: `/commons/rooms/:roomId/admin`, `/commons/rooms/:roomId/display`, and `/commons/join/:joinCode`. These are proposals, not existing endpoints. A join code maps to a room and participant access only; it is never an admin credential. Decide whether displays are public-by-link or require a separate read-only token.

## Next steps, in order

### 1. Discover the website and agree on an integration design

This is the next task when implementation planning resumes. Obtain the website repository/domain and inspect its applicable agent guidance, authentication, Google services, routing, deploy configuration, storage, and environment separation without exposing secrets. Record what is already deployed versus merely configured.

Agree on initial targets: simultaneous rooms, participants per room, expected control-update rate, typical event duration, acceptable reconnect time, generation usage, and operating budget. Decide whether participants can join anonymously, whether rooms are listed or unlisted, how invitation rotation works, and who pays for generation. Do not invent capacity or pricing claims.

Deliverable: a short architecture decision document mapping each responsibility below to the existing Google stack, with any proposed additions, expected cost drivers, deployment/rollback plan, and unresolved decisions. Verify current connection/request limits and background-work behavior for the chosen services. A hosting move alone is not multi-room support.

### 2. Define room identity and isolation locally

After authorization to build, introduce a room domain model and isolate the existing behavior before deploying it. Model room ID, owner identity, status, participant invite mapping, active sketch/version, saved values, presets, undo, and generation jobs. Scope request IDs, participant identities, telemetry, and browser storage to rooms. The inherited library can remain shared read-only content; generated work and saved looks need an explicit ownership policy.

Resolve and authorize the room on every API and WebSocket connection/message. Bind connections to the authorized room rather than trusting arbitrary message room IDs. Keep participant tokens private and scoped; check creator ownership on the server for every admin operation and job read. Treat room IDs as identifiers, not proof of permission.

Acceptance: two rooms can run concurrently with different art, controls, owners, presets, jobs, and undo. Changes, reconnects, stale requests, and joins in one never affect or disclose private state in the other. A second creator cannot read or mutate another owner's jobs/presets by guessing IDs.

### 3. Establish durable state and consistent live updates

Select persistence and live transport from the verified Google stack. Explicitly distinguish durable room metadata/sketches/jobs from transient presence and frequent control updates. Plan checkpoint frequency and recovery rather than writing every frame or knob event indiscriminately.

If retaining WebSockets, design reconnect/backoff, room resubscription, full state recovery, and deployment draining. If multiple instances can serve a room, select a coordination mechanism that enforces one authoritative accepted order of updates and shared-control holds. Session affinity alone is not a consistency or durability design. Evaluate a managed realtime alternative against the same behavior and measured update cost.

Move generation to durable dispatch/work processing appropriate to the hosting environment. Scope concurrency per room, reserve work atomically, make completion/publication idempotent, and reject stale results by room/sketch version. Duplicate delivery or a worker crash must not silently repeat paid generation. Record uncertain in-flight provider outcomes for explicit recovery. Preserve the single validation-aware repair and account for its second call in quotas/deadlines.

Acceptance: reconnect, restart, duplicate job delivery, and multiple instances do not mix rooms, duplicate publication, violate shared turns, or silently repeat paid work. One room's slow generation does not block other rooms. Local private demo data is not migrated automatically.

### 4. Add room creation, display links, and per-room QR codes

Integrate the website's login with room creation and ownership. Add the creator's room list/desk and room-specific display/participant routes. Generate QR codes from a trusted canonical HTTPS origin and the room's join link; never include admin sessions, model keys, or private job URLs. Define closed, unknown, expired, and revoked invitation states. Invitation changes must update that room's display only.

Acceptance: two creators each create a room, open the correct display, and scan different QR codes on real phones. Each phone controls only its intended room; public users cannot invoke generation or enumerate private jobs. Reloading pages retains the correct room and role.

### 5. Prepare for untrusted creators and bounded operating costs

Before public room creation, isolate drawing execution from authenticated website pages and credentials. Design a restricted renderer boundary (for example, a sandboxed frame on a separate origin) with a narrow, validated messaging interface, controlled network access, and recovery from runtime errors or runaway drawing. Evaluate the boundary for both existing runtimes without combining their contracts. Shape/syntax validation is not a sandbox; granting someone their own room does not make their generated code trusted by the website.

Add per-owner/per-room generation quotas, concurrent-job limits, participant/message limits, and a global spending stop. Store credentials in the selected server-side secret mechanism, not browser bundles or QR content. Keep prompts, participant tokens, and credentials out of general logs; define data retention and deletion. Keep the facilitator disabled until its per-room consent and spending behavior are designed.

Acceptance: a room's sketch cannot access website login state, other rooms' data, or unapproved network destinations; a broken sketch can be recovered without losing creator access. Quotas include repair calls and hold under concurrent requests.

### 6. Stage, measure, then launch

Deploy first to a separate Google-backed staging environment using the agreed stack. Test full owner/participant flows, hostile cross-room requests, real-phone QR joining, long sessions, reconnects, worker failure, rollout/restart behavior, and rollback. Load-test the agreed room/participant targets and measure latency, memory, disconnects, generation outcomes, and cost. Publish measured capacity, not assumptions.

The production milestone is a stable website URL that continues working with the development laptop off. Document operations, monitoring, recovery, retention, and rollback before launch. The laptop gateway and Cloudflare Quick Tunnel remain optional historical demo tooling, not dependencies of hosted rooms.

## Invariants throughout the migration

- Fresh generation produces native Canvas2D JavaScript in `code`; inherited p5.js instance-mode pieces use `p5Code`. Never merge these contracts or rewrite the inherited library for the hosting migration.
- Generate executable drawing code only. Never add image or video generation.
- Preserve create versus remix, compatible settings, stale-source rejection, durable undo, fallback visibility, and job idempotency.
- Preserve automatic balanced assignments, four-second shared turns, and the 30-second disconnect grace within each room.
- Keep tests isolated from paid providers and production data. Run `git diff --check` and `npm run verify` after changes, adding meaningful room/isolation/failure tests as implementation grows.
- Keep credentials, local jobs, QR output, and `.commons-data/` private. Do not push until requested.
