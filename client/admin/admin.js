let authenticated = false;
let remixing = false;
const promptSend = document.getElementById('promptSend');
const promptStatus = document.getElementById('promptStatus');
const undoPiece = document.getElementById('undoPiece');
const modeOptions = document.getElementById('modeOptions');
const presetSelect = document.getElementById('presetSelect');
const loadPreset = document.getElementById('loadPreset');
const savePreset = document.getElementById('savePreset');
let canvas = null;
const mode = () => document.querySelector('input[name="mode"]:checked').value;
function updateConnection() {
  promptSend.disabled = !authenticated || remixing || (mode() === 'remix' && !canvas?.sketchId);
  modeOptions.disabled = remixing;
  undoPiece.disabled = !authenticated || remixing || !canvas?.canUndo;
  loadPreset.disabled = !authenticated || remixing || !presetSelect.value;
  savePreset.disabled = !authenticated || remixing;
  promptSend.textContent = remixing ? 'Composing…' : mode() === 'remix' ? 'Remix this piece ↗' : 'Create a new piece ↗';
}
async function refreshCanvas() {
  if (!authenticated) return;
  try {
    const response = await fetch('/api/admin/canvas');
    if (!response.ok) return;
    canvas = await response.json();
    document.getElementById('currentPiece').textContent = `On the wall: ${canvas.name}`;
    updateConnection();
  } catch {}
}
modeOptions.addEventListener('change', () => {
  remember('commons-admin-mode', mode());
  updateConnection();
});
function setAuthenticated(value) {
  authenticated = value;
  document.getElementById('loginForm').hidden = value;
  document.getElementById('creatorTools').hidden = !value;
  updateConnection();
  if (value) { refreshCanvas(); refreshPresets(); }
}
const draftKey = 'commons-admin-draft';
const jobKey = 'commons-admin-remix';
const promptInput = document.getElementById('promptInput');
function remember(key, value) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch {}
}
function recalled(key) { try { return localStorage.getItem(key); } catch { return null; } }
promptInput.value = recalled(draftKey) || '';
const savedMode = recalled('commons-admin-mode');
if (savedMode === 'create') document.querySelector('input[value="create"]').checked = true;
promptInput.addEventListener('input', () => remember(draftKey, promptInput.value));
const pause = () => new Promise((resolve) => setTimeout(resolve, 2000));
function requestId() {
  // randomUUID requires HTTPS; venue phones may reach the server over LAN HTTP.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function followRemix(request) {
  remixing = true;
  remember(jobKey, JSON.stringify(request));
  promptSend.textContent = 'Remixing…';
  promptStatus.textContent = 'Starting your remix. Your idea is saved.';
  promptStatus.dataset.error = 'false';
  updateConnection();
  let submitted = false;
  try {
    while (true) {
      let response;
      let job;
      try {
        // Retrying this POST after a reload or lost response reuses the same
        // request ID: the server returns the existing job, never a second call.
        response = submitted
          ? await fetch(`/api/generations/${request.id}`, { signal: AbortSignal.timeout(10_000) })
          : await fetch('/api/generations', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: request.prompt, requestId: request.id, mode: request.mode || 'create', baseSketchId: request.baseSketchId }),
            signal: AbortSignal.timeout(10_000),
          });
        job = await response.json();
      } catch {
        promptStatus.textContent = 'Reconnecting to your remix. Your prompt is saved; the server keeps working.';
        await pause();
        continue;
      }
      if (response.status === 401) {
        setAuthenticated(false);
        document.getElementById('loginStatus').textContent = 'Sign in again to return to your saved remix.';
        break;
      }
      if (!response.ok) {
        promptStatus.textContent = response.status === 409
          ? (job.error || 'A remix is already in progress. Your idea is saved — try again when it finishes.')
          : 'Couldn’t reconnect to this remix. Your idea is saved — try again.';
        promptStatus.dataset.error = 'true';
        remember(jobKey, null);
        break;
      }
      submitted = true;
      if (job.status === 'generating') {
        const elapsed = Math.max(0, Math.floor((Date.now() - job.createdAt) / 1000));
        promptStatus.textContent = `Composing the next piece · ${elapsed}s. Your prompt is saved. You can reload and return.`;
        await pause();
        continue;
      }
      remember(jobKey, null);
      if (job.status === 'completed' || job.status === 'fallback') {
        const sketch = job.sketch;
        promptStatus.textContent = job.status === 'fallback'
          ? `Showing ${sketch.name} from the library. The requested piece couldn’t finish; your idea is saved to try again.`
          : `${job.applied ? 'On the wall' : 'Saved remix'}: ${sketch.name}.`;
      } else {
        promptStatus.textContent = job.error || 'The remix was interrupted. Your idea is saved — try again.';
        promptStatus.dataset.error = 'true';
      }
      break;
    }
  } finally {
    remixing = false;
    promptSend.textContent = 'Remix for the room ↗';
    updateConnection();
    await refreshCanvas();
    await refreshPresets();
  }
}

document.getElementById('promptForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const prompt = promptInput.value.trim();
  if (!prompt || remixing || !authenticated) return;
  remember(draftKey, promptInput.value);
  followRemix({ id: requestId(), prompt, mode: mode(), baseSketchId: canvas?.sketchId });
});
async function refreshPresets() {
  if (!authenticated) return;
  try {
    const response = await fetch('/api/admin/presets');
    if (!response.ok) return;
    const presets = await response.json();
    const selected = presetSelect.value;
    presetSelect.replaceChildren(new Option('Choose a piece…', ''));
    const groups = new Map();
    for (const preset of presets) {
      if (!groups.has(preset.kind)) {
        const group = document.createElement('optgroup'); group.label = preset.kind;
        groups.set(preset.kind, group); presetSelect.append(group);
      }
      const stamp = preset.savedAt ? new Date(preset.savedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      groups.get(preset.kind).append(new Option(stamp ? `${preset.name} · ${stamp}` : preset.name, preset.id));
    }
    presetSelect.value = selected;
    updateConnection();
  } catch { document.getElementById('presetStatus').textContent = 'Couldn’t load the library. Reload to reconnect.'; }
}
presetSelect.addEventListener('change', updateConnection);
loadPreset.addEventListener('click', async () => {
  loadPreset.disabled = true;
  try {
    const response = await fetch('/api/admin/presets/load', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ presetId: presetSelect.value }) });
    const result = await response.json();
    document.getElementById('presetStatus').textContent = response.ok ? `On the wall: ${result.name}.` : result.error;
  } catch { document.getElementById('presetStatus').textContent = 'Couldn’t load this piece. Try again.'; }
  await refreshCanvas();
});
savePreset.addEventListener('click', async () => {
  savePreset.disabled = true;
  try {
    const response = await fetch('/api/admin/presets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: document.getElementById('presetName').value }) });
    document.getElementById('presetStatus').textContent = response.ok ? 'Saved to your library, including the current settings.' : 'Couldn’t save this look. Try again.';
  } catch { document.getElementById('presetStatus').textContent = 'Couldn’t save this look. Try again.'; }
  await refreshPresets();
  updateConnection();
});
undoPiece.addEventListener('click', async () => {
  undoPiece.disabled = true;
  try {
    const response = await fetch('/api/admin/undo', { method: 'POST' });
    const result = await response.json();
    promptStatus.textContent = response.ok ? `Restored ${result.name}, including its previous settings.` : result.error;
    promptStatus.dataset.error = String(!response.ok);
  } catch { promptStatus.textContent = 'Couldn’t restore the previous piece. Try again.'; }
  await refreshCanvas();
});
function resumeRemix() {
  try {
    const pendingJob = JSON.parse(recalled(jobKey));
    if (pendingJob?.id && typeof pendingJob.prompt === 'string') followRemix(pendingJob);
  } catch { remember(jobKey, null); }
}

document.getElementById('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = document.getElementById('adminPassword');
  const status = document.getElementById('loginStatus');
  try {
    const response = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: password.value }) });
    if (!response.ok) { status.textContent = 'That password didn’t work. Try again.'; return; }
    password.value = '';
    status.textContent = '';
    setAuthenticated(true);
    document.getElementById('promptInput').focus();
    if (!remixing) resumeRemix();
  } catch { status.textContent = 'Couldn’t connect. Try again.'; }
});
document.getElementById('logout').addEventListener('click', async () => {
  try {
    const response = await fetch('/api/admin/logout', { method: 'POST' });
    if (response.ok) setAuthenticated(false);
  } catch { promptStatus.textContent = 'Couldn’t sign out. Try again.'; }
});
fetch('/api/admin/session').then((response) => response.json()).then((session) => {
  setAuthenticated(session.authenticated);
  if (session.authenticated) resumeRemix();
  else if (!session.configured) document.getElementById('loginStatus').textContent = 'Set ADMIN_PASSWORD in the server’s .env file to open the creator desk.';
}).catch(() => { document.getElementById('loginStatus').textContent = 'Couldn’t reach the server. Reload to reconnect.'; });
