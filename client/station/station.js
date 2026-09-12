// Generic controls for either sketch contract. Display labels may replace
// underscores, but the original values always travel over the relay.
const table = new URLSearchParams(location.search).get('table')
  || `table-${Math.random().toString(36).slice(2, 6)}`;
document.getElementById('tableName').textContent = `Table / ${table}`;
const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
const ws = new WebSocket(`${wsProto}://${location.host}/ws?role=station&table=${encodeURIComponent(table)}`);
const knobsEl = document.getElementById('knobs');
const connection = document.getElementById('connection');
const promptSend = document.getElementById('promptSend');
const promptStatus = document.getElementById('promptStatus');
const selected = new Map();
let remixing = false;

function updateConnection() {
  const live = ws.readyState === WebSocket.OPEN;
  connection.textContent = live ? 'Connected' : 'Disconnected · reload to rejoin';
  connection.dataset.state = live ? 'live' : 'offline';
  knobsEl.querySelectorAll('button').forEach((button) => { button.disabled = !live; });
  promptSend.disabled = !live || remixing;
}

function render(sketch) {
  if (!sketch) return;
  document.getElementById('sketchName').textContent = sketch.name;
  knobsEl.replaceChildren();
  selected.clear();
  for (const v of sketch.variables || []) {
    selected.set(v.name, v.values?.[0]?.text);
    const wrap = document.createElement('fieldset');
    wrap.className = 'knob';
    const label = document.createElement('legend');
    label.textContent = v.label || v.name.replaceAll('_', ' ');
    wrap.appendChild(label);
    const row = document.createElement('div');
    row.className = 'values';
    for (const val of v.values || []) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = val.text.replaceAll('_', ' ');
      btn.classList.toggle('active', selected.get(v.name) === val.text);
      btn.setAttribute('aria-pressed', String(selected.get(v.name) === val.text));
      btn.onclick = () => {
        if (ws.readyState !== WebSocket.OPEN) return;
        selected.set(v.name, val.text);
        // Preserve focus and touch feedback instead of rebuilding every knob.
        for (const sibling of row.children) {
          sibling.classList.toggle('active', sibling === btn);
          sibling.setAttribute('aria-pressed', String(sibling === btn));
        }
        ws.send(JSON.stringify({ type: 'var', varName: v.name, value: val.text }));
      };
      row.appendChild(btn);
    }
    wrap.appendChild(row);
    knobsEl.appendChild(wrap);
  }
  updateConnection();
}
ws.onopen = updateConnection;
ws.onclose = updateConnection;
ws.onerror = updateConnection;
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.type === 'welcome' || msg.type === 'sketch') render(msg.sketch);
};

document.getElementById('promptForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const promptInput = document.getElementById('promptInput');
  const prompt = promptInput.value.trim();
  if (!prompt || remixing || ws.readyState !== WebSocket.OPEN) return;
  remixing = true;
  promptSend.textContent = 'Remixing…';
  promptStatus.textContent = 'Finding the room’s next piece…';
  promptStatus.dataset.error = 'false';
  updateConnection();
  try {
    const response = await fetch('/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    if (!response.ok) throw new Error('Remix failed');
    const sketch = await response.json();
    promptStatus.textContent = sketch.fallback
      ? `Now on the wall: ${sketch.name}. Chosen from the built-in library.`
      : `Now on the wall: ${sketch.name}.`;
  } catch {
    promptStatus.textContent = 'Couldn’t remix the room. Your idea is still here — try again.';
    promptStatus.dataset.error = 'true';
  } finally {
    remixing = false;
    promptSend.textContent = 'Remix for the room ↗';
    updateConnection();
  }
});
