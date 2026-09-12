# Operating The Commons

## Local configuration

Copy `.env.example` to `.env` once. The example contains blank credential fields; fill them only in the local file. No OpenAI key is required. For Gemini, set `GENERATION_PROVIDER=gemini` and either `GEMINI_API_KEY` or `GEMINI_CONFIG_PATH` to a server-local JSON file with an `api_key` field. Do not place that file in `client/`.

Set `GENERATION_PROVIDER=fallback` to guarantee zero model calls. With a live provider, `FACILITATOR_ENABLED=false` allows only explicit admin generation; `true` also permits autonomous calls after room inactivity. Restart the app after changing environment settings. Leave the tunnel running to preserve its current address.

Set `ADMIN_PASSWORD` locally before opening `/admin/`. A blank value disables sign-in. Password values do not belong in documentation, screenshots, recordings, or commits. Server restarts invalidate admin sessions; sign in again afterward.

## What guests can reach

The main app listens on all IPv4 interfaces to support phones on the same LAN. Its admin endpoints require authentication, but the main port is not restricted to the laptop. Use a trusted demo network and keep the creator desk on the laptop.

The optional audience gateway listens on `127.0.0.1:4189` and forwards only station, display, shared assets, and the WebSocket relay. It strips incoming cookies and authorization headers. Admin, generation, job, and preset API routes are blocked. Tunnel this gateway, never the main app port. The gateway is a demo access boundary, not a production hosting setup.

Anyone with the audience link can join the single room and receive controls. Per-tab session tokens preserve individual assignments; public table labels confer no ownership. A generated sketch's code and control definitions are broadcast so browsers can render it. They are not private content. Model keys and admin passwords are not part of that broadcast.

Sketches execute JavaScript in the display browser. Validation checks their shape and syntax; it is not a security sandbox. Only trusted creators should supply generation prompts and prepared visuals. The inherited renderer and fonts also load browser libraries/assets from external hosts, so test with the event's actual connectivity.

## Saved work and recovery

The default private data directory is `.commons-data/generations/`. It holds prompts, completed jobs, named presets, and saved room state. Back up that directory privately to preserve your prepared set. If overriding `GENERATION_DATA_DIR`, keep the destination outside public assets and tracked repository files.

- A browser reload reconnects to the same saved job, without another paid call.
- A model timeout retains the idea and selects fallback content. Retry explicitly; partial provider output cannot be resumed.
- A server restart preserves completed saved work and marks unfinished requests interrupted. It cannot resume an upstream model request. Reload stations after a restart.
- **Undo last change** restores one preceding piece and its saved settings without a model call. It is unavailable while generation is running.
- Successful generations enter the preset library automatically. **Save current look** also captures current control values. Normal live knob changes are not a continuous backup of every adjustment.

## Before pushing or recording

Git ignores `.env` variants (except the blank `.env.example`), `ai_studio_config.json`, private key files, `.commons-data/`, logs, and generated QR assets. Ignore rules do not remove anything already committed: review both staged changes and outgoing commit history. Never force-add private files.

Run `npm run verify` and review `npm audit`. Inspect the exact files being published, including their history, for credentials. A local scanner such as Gitleaks can check Git history with redacted output; supplement it with checks for the actual locally configured key without printing that key. Keep scan reports private. Local generated presets, event addresses, and credentials should not be part of a clean clone.

Before recording, hide terminals containing configuration, sign in off-camera, and use the participant QR. A prepared preset is the quickest recovery if a live generation is slow. See [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md) for the complete rehearsal.
