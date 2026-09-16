# The Commons — development handoff

Updated: 2026-09-16. The hackathon is complete; this is now post-event product work.

## Product direction and current scope

The owner wants The Commons to become a tool at **https://synthograsizer.com/thecommons**, integrated into the **synthograsizer-suite** Git repository and hosted through the Google Cloud services already running synthograsizer.com. These targets were explicitly confirmed by the owner; the existing deployment configuration has not yet been inspected. People should be able to create their own rooms and administer them. Each room needs its own display page and a QR code that brings participants into that room's controls. Hosting must operate independently of the owner's laptop and temporary Cloudflare tunnels.

**This direction is recorded, not implemented.** The latest instruction is to document the next steps without building the hosted multi-room product yet. Do not provision infrastructure, deploy, change the website, or start the room refactor merely because this plan exists. Do not push without an explicit request.

The website domain and destination repository are confirmed above. The suite's deployment configuration and auth/credit code have now been inspected locally (findings below) — this is not a live Google Cloud account audit; recheck the active project, revisions, IAM, and billing settings before deployment. Reuse the existing stack (Cloud Run, Cloud SQL, Google Identity Services) and check current official documentation before changing any service configuration.

## Suite integration: deployment and account findings

Inspected locally in `synthograsizer-suite` on 2026-09-16. No suite code or deployment was changed; these are read-only findings, not a live Cloud Console audit.

- Checkout: `C:\Users\Alexander\Projects\synthograsizer-suite`; remote: <https://github.com/quitters/synthograsizer.git>. The directory name differs from the GitHub repository name.
- Current branch is `chatroom/gemini-modernization-phases-0-1`, with an existing modification to `chatroom/server/services/gemini.js` and an untracked `chatroom/.run-pid`. Preserve both — do not deploy this working tree or merge unrelated ChatRoom work by accident. Branch a clean integration branch from an agreed suite base once implementation starts.
- Deployment (`docs/DEPLOY_CLOUDRUN.md`): Cloud Run service `synthograsizer`, project `synthograsizer-app`, region `northamerica-northeast1`, Cloud SQL Postgres `synth-db`. The container runs the suite's Python/FastAPI app via Uvicorn — it does not run The Commons' Node server. Copying Commons files into the suite does not start a second server; the integration design has to decide how Commons is served (same process/router, a sidecar, a separate Cloud Run service behind the same proxy, etc.).
- The service is pinned to `--min-instances 1 --max-instances 1` with a 600s timeout and session affinity. Scaling past one instance needs shared rate-limit/budget state first (the runbook says so explicitly) — relevant because Commons' realtime relay is currently process-local, single-instance state.
- `synthograsizer.com` reaches Cloud Run through a Vercel proxy (`vercel.json` rewrites all paths). `/thecommons` would ride that same proxy unless a different routing decision is made. Confirm the proxy forwards WebSocket upgrades before relying on that transport at `/thecommons`.
- Deploys use `gcloud run deploy ... --set-env-vars "..."`, which **replaces the entire service environment** — not additive. The runbook documents a real 2026-07-20 incident where a routine redeploy silently wiped `SYNTH_PUBLIC_ORIGINS` and broke every POST through the domain. Any deployment guide for Commons must account for this (either fold Commons' env vars into the one `--set-env-vars` list, or use `--update-env-vars` and re-apply it after every deploy per the runbook's own rule).
- Identity: `SYNTH_HOSTED=1` / `SYNTH_AUTH=1` enable hosted auth. `backend/service/auth.py` verifies Google Identity Services ID tokens (signature/audience/expiry via `google-auth`, plus issuer and `email_verified`), upserts the user by Google's stable `sub`, and issues an opaque HttpOnly `SameSite=Lax` session cookie (`synth_session`) — Google's own token is never stored. This is the identity boundary to reuse for Commons room creators; it should not need a second login system.
- Admin is computed from `ADMIN_EMAILS` (env, not a DB column) via `effective_tier()`. Admin tier bypasses credit debits (`credits.py`), the daily budget breaker, and per-user rate limiting (`enforcement.py`). **A Commons room owner must never be granted this tier** — it is a suite-operator concept, not a room-owner concept, and would remove all spend limits for that account across every suite tool.
- Charging (`backend/service/credits.py`) is reserve-then-settle: `Charge.reserve()` does one atomic conditional `UPDATE ... WHERE credits_balance >= cost` (no overspend race), inserts a `generations` row as `status='failed'`, and flips it to `'ok'` on `commit()` or refunds on any exception (`__aexit__`). The invariant `SUM(credit_ledger.delta) == users.credits_balance` is tested. This reserve/commit/refund pattern — not a bolt-on charge-after-the-fact — is the model Commons generation (including the repair call) should follow.
- `backend/service/budget.py` is a daily USD circuit breaker: sums `generations.usd_est` for the UTC day, caches the sum for ~30s per process (coherent only because `max-instances=1`), and **fails open** on any DB error ("never let a broken breaker take the service down"). It is a last-line defense against a bug or leaked session, not a hard per-room or per-owner cap — Commons needs its own per-owner reservation logic on top of it, not instead of it.
- `backend/service/enforcement.py` is one always-registered middleware that gates a fixed prefix list (`AI_PREFIXES`, e.g. `/api/generate/`, `/api/chat`, ...) behind session + terms + rate-limit + budget checks, and 403s a separate `DISABLED_PREFIXES` list (things like local file/OSC/scope endpoints that don't make sense multi-tenant on Cloud Run). **A new `/thecommons/...` or room-job route will not automatically inherit these guards** — it has to either live under an existing guarded prefix or get its own explicit session/CSRF/ownership/terms/rate-limit/budget wiring. The HTTP middleware also does not see WebSocket scope (the suite's own Lyria endpoint gates itself separately in its router) — Commons' `/ws` relay will need the same kind of independent enforcement.
- Same-origin/CSRF: unsafe methods on guarded paths require a matching `Origin`/`Referer`, with an operator-set allowlist via `SYNTH_PUBLIC_ORIGINS` for exactly this kind of proxy-fronted case. `/thecommons` will need its own origins covered by (or already covered by) that allowlist.

### Decided access rules for The Commons

| Action | Access requirement | Model spending |
|---|---|---|
| Open the landing page | Public | None |
| Create a room / list owned rooms | Verified Google session | No model call just to create an empty room |
| Open/use room admin tools (generate, remix, undo, presets) | Verified Google session **and** server-checked ownership of that room | Charged to the owner's existing suite credits |
| Scan QR / open participant controls | No account, no Google login — room-scoped anonymous participant token | None — participants must have no path to trigger generation |
| View a room display | Per the room's link policy | None |

This resolves the "who pays for generation" and "can participants join anonymously" questions raised in [Next steps § 1](#1-discover-the-website-and-agree-on-an-integration-design) below: room creators authenticate with their existing Google account and spend their own suite credits; participants never authenticate and can never spend credits. A **room owner is not a suite operator** — never add a room creator to `ADMIN_EMAILS` or grant the `admin` tier; that would exempt them from every spend limit suite-wide, not just give them their room.

### Credit-enforcement gaps to close during implementation

These are gaps between the suite's existing (single-app) credit system and what a multi-room, async-job product like Commons needs — not bugs in the suite as it stands today:

1. **New routes need explicit protection.** `enforcement.py`'s prefix lists won't automatically cover `/thecommons/...` or a WebSocket relay; wire session, CSRF-origin, ownership, terms, rate-limit, and charging explicitly, and enforce the participant-vs-owner role independently on the WebSocket path.
2. **Reserve before dispatch, including the repair call.** Follow the suite's reserve/commit/refund pattern: reserve credits (covering both the initial call and a possible repair call) before starting a durable job, persist the owner/room/job/charge relationship, and make job-start responses (202-style) distinct from settlement. Deduplicate submissions/deliveries so a reload or retried worker delivery can't double-charge or double-dispatch.
3. **The daily breaker is a backstop, not a cap.** `budget.tripped()` fails open on DB errors and is only ~30s-coherent (fine at `max-instances=1`). Commons needs its own per-owner reservation on top of it — a Google account identifies a spender, it doesn't bound one.
4. **Make job accounting recoverable.** The suite's own charge/generations-row/ledger-row are three separate writes reconciled by an implicit invariant, not one atomic transaction — model Commons' job/reservation/settlement records the same deliberate way, with defined recovery for crashes, duplicate workers, and provider-outcome uncertainty (repair especially, since it's a second paid call inside one job).
5. **`--set-env-vars` replaces the whole environment.** Any new Commons-specific env vars must go into the deploy runbook's env-var list (or be re-applied via `--update-env-vars` after every deploy) — see the finding above and the runbook's own 2026-07-20 incident note.

Required integration tests (future, not implemented yet): anonymous room creation/admin/generation returns an auth error; a signed-in non-owner cannot read or mutate another owner's room; room owners never receive the `admin` tier's exemptions; anonymous QR participant controls work with no session; zero credits blocks new generation while the current canvas keeps running; concurrent rooms cannot together exceed their shared owner's balance; the repair call and duplicate job delivery cannot bypass charging; an unavailable budget/account store blocks new paid calls rather than allowing them.

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
- Branch: `main`, pushed and in sync with `origin/main` as of this update (generation repair, handoff creation, and the Synthograsizer integration/deployment findings above have all landed on `origin/main`). Recheck `git status --short --branch` before further work rather than assuming this stays true.
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

1. A creator opens The Commons on the existing website and must sign in with their Google account through the suite's existing identity system before creating a room or accessing its admin tools.
2. The creator creates a room and becomes its owner/admin. They receive a creator desk, a unique display URL, and a participant URL represented as a QR code.
3. A display opens that room's canvas. Participants scan the QR and receive controls for that room without Google sign-in or an account, with the current automatic allocation and shared-turn behavior.
4. Only the room owner can generate/remix, load or save looks, undo, and manage the room. Participant access does not confer creator permissions.
5. The owner can close the room and manage access. Define reopening, expiration, retention, and deletion behavior before implementing those actions.

Illustrative routes, subject to the website's routing conventions: `/thecommons/rooms/:roomId/admin`, `/thecommons/rooms/:roomId/display`, and `/thecommons/join/:joinCode`. These are proposals, not existing endpoints. A join code maps to a room and participant access only; it is never an admin credential. Decide whether displays are public-by-link or require a separate read-only token.

## Next steps, in order

### 1. Discover the website and agree on an integration design

This is the next task when implementation planning resumes. Locate and verify the synthograsizer-suite checkout and remote, read its applicable agent guidance, and inspect its authentication, Google services, routing, deploy configuration, storage, and environment separation without exposing secrets. Record what is already deployed versus merely configured. Plan the integration within that repository rather than assuming TheCommons will deploy as an independent repository. Decide how to preserve attribution and maintain the imported code without conflicting with the suite's existing template tooling. Do not copy local credentials, jobs, or generated QR assets.

Treat /thecommons as the required public base path. Audit root-relative asset links, API requests, WebSocket URLs, redirects, login callbacks, cookie paths, and QR URLs; the standalone app currently assumes root routes. Verify direct navigation and reloads on nested room pages. Adapt the existing site routing/proxy configuration without breaking other suite tools. A shared domain does not remove the need to isolate generated code from site credentials.

Agree on initial targets: simultaneous rooms, participants per room, expected control-update rate, typical event duration, acceptable reconnect time, generation usage, and operating budget. Anonymous participant access and Google-authenticated, credit-metered room creation/admin access are decided (see [Decided access rules](#decided-access-rules-for-the-commons) above). Still open: whether rooms are listed or unlisted, how invitation rotation works, and the exact credit tariff for Commons generation within the suite's pricing model. Do not invent capacity or pricing claims.

Deliverable: a short architecture decision document mapping each responsibility below to the existing Google stack, with any proposed additions, expected cost drivers, deployment/rollback plan, and unresolved decisions. Verify current connection/request limits and background-work behavior for the chosen services. A hosting move alone is not multi-room support.

### Serving-model decision (informed by the ChatRoom precedent)

The suite already has a directly analogous situation: **ChatRoom** (`chatroom/`) is a separate Node/Express + React app that makes its own autonomous, server-initiated Gemini calls — architecturally the same shape as Commons' generation jobs. It is **not deployed to Cloud Run at all**: the Dockerfile copies only `backend/`, `static/`, and `scripts/`; ChatRoom is excluded, and `enforcement.py` returns 503 for every `/chatroom/` request in hosted mode ("ChatRoom runs on local installs only"). The suite's own `REPO_MAP.md` gives the reason: ChatRoom "runs autonomous multi-agent Gemini turn-taking server-side, which would have to be credit-metered first" before it could go hosted. Commons is in that same position today — a Node server making its own server-side model calls, with no credit metering.

By contrast, the suite's `workflow-engine/` *did* get a hosted path, because it never talks to Gemini directly: it's pure ESM that runs **client-side in the browser**, making authenticated `fetch()` calls to the existing `/api/*` routes — "each step becomes an authenticated `/api/*` call, so credits, rate limits, and the budget breaker apply per step via the existing middleware" (`REPO_MAP.md` §4). That pattern doesn't fit Commons: the model key must stay server-side, and Commons also needs a persistent WebSocket relay for shared real-time control and durable job state, neither of which a browser-driven client can own.

So the real choice is between three ways to get Commons' server logic hosted, credit-metered, and behind the suite's existing auth:

**A — Port Commons' server logic into the FastAPI backend**, as new `backend/routers/thecommons.py` plus a WebSocket route for the relay, reusing `auth.py` / `credits.py` / `enforcement.py` / `budget.py` directly, in-process. This matches how every other AI-calling feature in the suite is already structured (one file per API domain in `backend/routers/`, per `REPO_MAP.md` §2). No duplicated security logic, no cross-service calls, ships inside the existing container. Cost: `server/relay.js`, `server/generation-jobs.js`, `server/validate-sketch.js`, and `server/generate.js` (including the just-added repair-call logic) all need a real Python rewrite. FastAPI/Starlette supports WebSockets natively, so the relay is portable — just not automatic.

**B — Deploy Commons as its own Cloud Run service**, Node unchanged, fronted by the same Vercel proxy under `/thecommons`. Minimal rewrite of Commons itself, but it would have to reimplement session-cookie verification, the reserve/commit/refund credit ledger, and the budget breaker independently against the same Postgres DB — exactly the duplication risk that made the suite keep ChatRoom local-only instead of deploying it this way. There's no precedent in this codebase of that path actually working end-to-end.

**C — Keep Commons as its own Node service, but call back into the FastAPI app for identity/credit operations** (verify-session, reserve/commit/refund) over an internal API, while Commons keeps owning its room/relay/job logic. Less rewrite than A, no duplicated security logic like B, but adds a second deployed service, an inter-service network call on every credit-touching request, and two deploy pipelines to keep in sync.

**Decided (2026-09-16): Option A — port to FastAPI.** The owner confirmed this after reviewing the tradeoffs above. It's the only option that doesn't duplicate or add a network hop in front of the exact credit/auth code the findings above already flag as easy to get subtly wrong (reserve-before-dispatch, the repair call's second charge, the daily breaker's fail-open behavior). It also means Commons' room isolation, WebSocket auth, and job durability get built once, directly against primitives that already exist (`request.state.user`, `charged()`, Postgres) — rather than re-deriving Node equivalents. The real cost is a genuine rewrite of Commons' Node server logic into Python, which the responsibility mapping below scopes.

**Independent of the serving model:** WebSockets through the Vercel proxy are untested. The runbook already flags that Vercel's edge timeout is "well under" Cloud Run's 600s ceiling as a risk for Veo's long *HTTP* requests — Commons' `/ws` relay is a long-*lived connection*, a different (and historically harder, for edge proxies) case than one long request. Smoke-test this early; if it doesn't hold up, routing may need to move to the ALB + serverless NEG path the runbook already anticipates for Veo.

### Responsibility mapping under the decided FastAPI port

This is the "map each responsibility to the existing Google stack" deliverable for stage 1, now that the serving model is fixed. All of this is still a design mapping, not a build — no files below have been created.

| Area | Current (Node) | Target under the FastAPI port |
|---|---|---|
| App wiring | `server/index.js` creates one relay and one job manager | A new `backend/routers/thecommons.py` (HTTP) plus a WebSocket route registered in `server.py`, following the suite's existing "router = thin handler, service = logic" split (`REPO_MAP.md` §2). Every handler resolves and authorizes an explicit room — no implicit single-room state. |
| Live state | `server/relay.js`: process-local participants, assignments, holds, values, telemetry, one shared `/ws` | A Python relay service keyed by room ID, in-process — consistent with the suite's current `--max-instances 1` pinning, so no cross-instance coordination is needed yet. Revisit only if the suite ever scales past one instance. |
| Creator access | `server/admin.js`: one `ADMIN_PASSWORD`, in-memory sessions | Reuse `auth.py`'s existing Google-session resolution as-is. Add a `rooms` table with an `owner_user_id` foreign key into the suite's `users` table, and a server-side ownership check on every admin operation — no second identity system. |
| Saved work | `server/generation-jobs.js`: local JSON files, including one `room-state.json` | Cloud SQL Postgres tables (rooms, room state/presets, generation jobs) alongside the suite's existing `users` / `generations` / `credit_ledger` tables — same database, same connection pool, no new datastore to operate. |
| Long-running work | A job runs in the app process and is interrupted by restart | Model Commons' job lifecycle on the same reserve/commit/refund shape `credits.py` already uses for `generations`: a job row inserted at reserve time, flipped to done/failed on settlement, recoverable after a crash. The repair call becomes a second reservation within the same job, not a separate untracked spend. |
| Client routes | Shared `/admin/`, `/display/`, `/station/` | Room-specific routes under `/thecommons/rooms/:roomId/...`, mounted the same way `static/synthograsizer/` etc. are today; room-scoped browser storage keys instead of global ones. |
| Invitations | `scripts/generate-join-qr.js`: shared static assets | Generate each room's QR from its canonical `https://synthograsizer.com/thecommons/join/:code` URL on demand — no shared file to overwrite. |
| Facilitator | Optional process, single room | Unchanged for now: stays disabled until per-room opt-in, spend limits, and its own reserve/commit/refund wiring are designed. |
| Drawing runtime | Model code runs in the display page; validation checks shape/syntax only | Unchanged scope, same open problem regardless of serving model: a sandboxed rendering boundary is still required before public room creation. |

Stage 1's serving-model and responsibility-mapping deliverables are now done. What's still open for stage 1: a live (not just repo-config) check of the actual Cloud Run project/IAM/billing state, and agreement on initial capacity/cost targets (simultaneous rooms, participants per room, event duration, operating budget). Stage 2 (room identity/isolation model) is the next piece of actual implementation, and per the standing instruction on this project, it has not been authorized to start yet.

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

## Required deployment guide for the owner

The owner specifically wants help knowing **what to type into the console** to run the improved suite on their existing Google Cloud setup. When implementation is ready, provide a checked, copy-and-paste deployment runbook in synthograsizer-suite, tailored to its actual services. Do not supply speculative deploy commands now or silently switch hosting platforms.

The runbook must:

1. Identify where each command runs (for example, Google Cloud Shell versus local PowerShell), required tools, repository directory, and the exact tested commit/branch. Explain Google Cloud Console UI steps separately from terminal commands.
2. Start with read-only checks of the active account, project, region, existing services, and deployment pipeline. Use verified non-secret values and clearly identify any remaining placeholders; never guess project IDs or overwrite an unrelated service.
3. Distinguish one-time setup from repeat deployments. Include the actual build/deploy or existing pipeline commands, routing configuration for /thecommons, durable storage/job setup, and secure server-side secret references without displaying credential values.
4. Explain each step briefly and show the expected success signal. Include any required data migration/backup, staging validation, production rollout, and an exact rollback procedure for both application and compatible data changes.
5. Verify https://synthograsizer.com/thecommons, nested display/join links, room ownership, cross-room isolation, QR scans on phones, live updates, and generation job recovery. Confirm the service works with the laptop off and the site's existing tools still work.
6. Document how to inspect logs/status safely, diagnose common failures, track usage/cost, and perform future updates. Identify steps that change resources, access, or billing before running them.

Creating this guide and carrying out deployment are separate steps. The current request records the requirement for later help; it does not authorize provisioning, deployment, or pushing repositories now.

## Invariants throughout the migration

- Fresh generation produces native Canvas2D JavaScript in `code`; inherited p5.js instance-mode pieces use `p5Code`. Never merge these contracts or rewrite the inherited library for the hosting migration.
- Generate executable drawing code only. Never add image or video generation.
- Preserve create versus remix, compatible settings, stale-source rejection, durable undo, fallback visibility, and job idempotency.
- Preserve automatic balanced assignments, four-second shared turns, and the 30-second disconnect grace within each room.
- Keep tests isolated from paid providers and production data. Run `git diff --check` and `npm run verify` after changes, adding meaningful room/isolation/failure tests as implementation grows.
- Keep credentials, local jobs, QR output, and `.commons-data/` private. Do not push until requested.
