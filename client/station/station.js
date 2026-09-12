// Generic controls for either sketch contract. Display labels may replace
// underscores, but the original values always travel over the relay.
import { defaultValue, numericValue } from '../shared/parameters.js';

let table = new URLSearchParams(location.search).get('table');
if (!table) {
  try { table = sessionStorage.getItem('commons-table'); } catch {}
  table ||= `table-${Math.random().toString(36).slice(2, 6)}`;
  try { sessionStorage.setItem('commons-table', table); } catch {}
}
document.getElementById('tableName').textContent = `Table / ${table}`;
const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
const sessionKey = `commons-session-${table}`;
let session = '';
try { session = sessionStorage.getItem(sessionKey) || ''; } catch {}
const ws = new WebSocket(`${wsProto}://${location.host}/ws?role=station&table=${encodeURIComponent(table)}&session=${encodeURIComponent(session)}`);
const knobsEl = document.getElementById('knobs');
const connection = document.getElementById('connection');


const selected = new Map();
const rows = new Map();
const sliders = new Map();
const pending = new Map();
let sendTimer;
const controlHint = document.getElementById('controlHint');

let hintTimer;
let participantId;
let owners = {};
const groups = new Map();

function updateOwnership(next = owners) {
  owners = next;
  let count = 0;
  for (const [name, group] of groups) {
    const mine = owners[name]?.some((person) => person.id === participantId);
    group.hidden = !mine;
    for (const input of group.querySelectorAll('input, button')) input.disabled = !mine || ws.readyState !== WebSocket.OPEN;
    if (!mine) pending.delete(name);
    if (mine) count++;
    group.querySelector('.control-sharing').textContent = mine && owners[name].length > 1
      ? `Shared with ${owners[name].length - 1} ${owners[name].length === 2 ? 'other person' : 'others'} · each turn holds for 4s` : 'Your control';
  }
  document.getElementById('allocationStatus').textContent = count
    ? `${count} ${count === 1 ? 'control is' : 'controls are'} yours. Others steer the rest of the canvas.`
    : 'You’re in the room. Waiting for a control to become available.';
}

function selectValue(name, value) {
  selected.set(name, value);
  const slider = sliders.get(name);
  if (slider) {
    slider.input.value = value;
    slider.output.value = String(value);
    slider.input.style.setProperty('--position', `${100 * (value - slider.min) / (slider.max - slider.min)}%`);
    return;
  }
  for (const button of rows.get(name)?.children || []) {
    const active = button.dataset.value === value;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

function flushSliders() {
  clearTimeout(sendTimer);
  sendTimer = null;
  if (ws.readyState === WebSocket.OPEN) {
    for (const [varName, value] of pending) ws.send(JSON.stringify({ type: 'var', varName, value }));
  }
  pending.clear();
}

function updateConnection() {
  const live = ws.readyState === WebSocket.OPEN;
  connection.textContent = live ? 'Connected' : 'Disconnected · reload to rejoin';
  connection.dataset.state = live ? 'live' : 'offline';
  updateOwnership();
  if (!live) { clearTimeout(sendTimer); sendTimer = null; pending.clear(); }

}

function render(sketch, values = {}, nextOwners = owners) {
  if (!sketch) return;
  document.getElementById('sketchName').textContent = sketch.name;
  knobsEl.replaceChildren();
  selected.clear();
  rows.clear();
  groups.clear();
  sliders.clear();
  pending.clear();
  clearTimeout(sendTimer);
  sendTimer = null;
  clearTimeout(hintTimer);
  controlHint.textContent = 'Your controls are assigned automatically as people join the room.';
  for (const v of sketch.variables || []) {
    selected.set(v.name, values[v.name] ?? defaultValue(v));
    const wrap = document.createElement('fieldset');
    wrap.className = 'knob';
    groups.set(v.name, wrap);
    const label = document.createElement('legend');
    label.textContent = v.label || v.name.replaceAll('_', ' ');
    label.id = `label-${knobsEl.children.length}`;
    wrap.appendChild(label);
    const sharing = document.createElement('p');
    sharing.className = 'control-sharing';
    wrap.appendChild(sharing);
    if (v.type === 'number') {
      const controls = document.createElement('div');
      controls.className = 'numeric-control';
      const output = document.createElement('output');
      output.className = 'numeric-value';
      output.setAttribute('aria-live', 'off');
      const input = document.createElement('input');
      input.type = 'range';
      input.id = `range-${knobsEl.children.length}`;
      input.min = v.min;
      input.max = v.max;
      input.step = v.step;
      input.setAttribute('aria-labelledby', label.id);
      output.htmlFor = input.id;
      const bounds = document.createElement('div');
      bounds.className = 'range-bounds';
      for (const text of [String(v.min), `Step ${v.step}`, String(v.max)]) {
        const part = document.createElement('span');
        part.textContent = text;
        bounds.appendChild(part);
      }
      sliders.set(v.name, { input, output, min: v.min, max: v.max });
      selectValue(v.name, selected.get(v.name));
      input.addEventListener('input', () => {
        const value = numericValue(v, input.valueAsNumber);
        if (value === null || !owners[v.name]?.some((person) => person.id === participantId) || ws.readyState !== WebSocket.OPEN) return;
        selectValue(v.name, value);
        pending.set(v.name, value);
        // Coalesce a drag to ~30 updates/sec. Release and keyboard changes
        // flush the final value so every table lands on the same setting.
        if (!sendTimer) sendTimer = setTimeout(flushSliders, 33);
      });
      input.addEventListener('change', flushSliders);
      controls.append(output, input, bounds);
      wrap.appendChild(controls);
      knobsEl.appendChild(wrap);
      continue;
    }
    const row = document.createElement('div');
    row.className = 'values';
    rows.set(v.name, row);
    for (const val of v.values || []) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.value = val.text;
      btn.textContent = val.text.replaceAll('_', ' ');
      btn.classList.toggle('active', selected.get(v.name) === val.text);
      btn.setAttribute('aria-pressed', String(selected.get(v.name) === val.text));
      btn.onclick = () => {
        if (!owners[v.name]?.some((person) => person.id === participantId) || ws.readyState !== WebSocket.OPEN) return;
        // Preserve focus and touch feedback instead of rebuilding every knob.
        selectValue(v.name, val.text);
        ws.send(JSON.stringify({ type: 'var', varName: v.name, value: val.text }));
      };
      row.appendChild(btn);
    }
    wrap.appendChild(row);
    knobsEl.appendChild(wrap);
  }
  updateOwnership(nextOwners);
  updateConnection();
}
ws.onopen = updateConnection;
ws.onclose = updateConnection;
ws.onerror = updateConnection;
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.type === 'welcome') {
    participantId = msg.participantId;
    try { sessionStorage.setItem(sessionKey, msg.session); } catch {}
  }
  if (msg.type === 'welcome' || msg.type === 'sketch') render(msg.sketch, msg.values, msg.owners);
  if (msg.type === 'ownership') updateOwnership(msg.owners);
  if (msg.type === 'var' || msg.type === 'not_owner' || msg.type === 'held') {
    // Do not rewind a drag to an earlier echo while a newer value is queued.
    if (msg.type !== 'var' || !pending.has(msg.varName)) selectValue(msg.varName, msg.value);
    if (msg.type === 'held') pending.delete(msg.varName);
    if (msg.type === 'not_owner') { pending.delete(msg.varName); updateOwnership(msg.owners); }
    clearTimeout(hintTimer);
    controlHint.textContent = msg.type === 'not_owner'
      ? 'This control now belongs to another participant. Your assigned controls are shown below.'
      : msg.type === 'held' ? `Table ${msg.table} is taking a turn on this shared control. Try again in a moment.`
      : msg.participantId === participantId ? 'Your turn is on the wall.' : 'Another participant changed the canvas.';
    hintTimer = setTimeout(() => {
      controlHint.textContent = 'Your controls are assigned automatically as people join the room.';
    }, 4000);
  }
};
