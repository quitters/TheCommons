// One table's control surface: on-screen knobs (works on any phone/laptop,
// no physical MIDI hardware required -- see README for why that's the
// practical choice, not just a fallback) plus a prompt box that can remix
// the whole shared piece for every table at once.

const table = new URLSearchParams(location.search).get('table')
  || `table-${Math.random().toString(36).slice(2, 6)}`;
document.getElementById('tableName').textContent = `you are: ${table}`;

const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
const ws = new WebSocket(`${wsProto}://${location.host}/ws?role=station&table=${encodeURIComponent(table)}`);

const knobsEl = document.getElementById('knobs');
const selected = {};

function render(sketch) {
  if (!sketch) return;
  knobsEl.innerHTML = '';
  for (const v of sketch.variables || []) {
    if (!(v.name in selected)) selected[v.name] = v.values?.[0]?.text;

    const wrap = document.createElement('div');
    wrap.className = 'knob';

    const label = document.createElement('label');
    label.textContent = v.label || v.name;
    wrap.appendChild(label);

    const row = document.createElement('div');
    row.className = 'values';
    for (const val of v.values || []) {
      const btn = document.createElement('button');
      btn.textContent = val.text;
      btn.className = selected[v.name] === val.text ? 'active' : '';
      btn.onclick = () => {
        selected[v.name] = val.text;
        render(sketch);
        ws.send(JSON.stringify({ type: 'var', varName: v.name, value: val.text }));
      };
      row.appendChild(btn);
    }
    wrap.appendChild(row);
    knobsEl.appendChild(wrap);
  }
}

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.type === 'welcome' || msg.type === 'sketch') render(msg.sketch);
};

document.getElementById('promptSend').addEventListener('click', async () => {
  const prompt = document.getElementById('promptInput').value.trim();
  if (!prompt) return;
  const btn = document.getElementById('promptSend');
  btn.disabled = true;
  btn.textContent = 'Remixing…';
  try {
    await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
  } finally {
    btn.disabled = false;
    btn.textContent = 'Remix for the room';
  }
});
