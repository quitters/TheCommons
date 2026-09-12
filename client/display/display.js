// The shared display: runs the current sketch every frame, reads live knob
// state pushed by the relay over WebSocket, and (optionally) analyses this
// machine's microphone input for a simple audio-reactivity signal.
//
// Two sketch contracts are supported, and they run through entirely separate
// paths -- nothing about one leaks into the other:
//   - `sketch.code`   -- native Canvas2D, documented in shared/contract.js.
//                        Used by every freshly-generated sketch (server/generate.js).
//   - `sketch.p5Code` -- p5.js instance-mode, the contract the INHERITED
//                        default template library (server/templates.js) was
//                        already written against. p5.js is loaded (index.html)
//                        only to run these -- generation never produces p5 code.

import { defaultValue } from '../shared/parameters.js';

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const p5Mount = document.getElementById('p5Mount');
const statusEl = document.getElementById('status');
const overlays = document.getElementById('displayOverlays');
const hideOverlays = document.getElementById('hideOverlays');

function setOverlaysHidden(hidden) {
  // Hide the parent so QR refreshes and microphone updates cannot reveal a child.
  // Each child's existing hidden/open state is preserved for when controls return.
  overlays.hidden = hidden;
  if (hidden) document.body.focus({ preventScroll: true });
  else hideOverlays.focus({ preventScroll: true });
}
hideOverlays.addEventListener('click', () => setOverlaysHidden(true));
addEventListener('keydown', (event) => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey
    || event.target.isContentEditable || event.target.closest('input, textarea, select')) return;
  if (event.key.toLowerCase() === 'f') {
    event.preventDefault();
    setOverlaysHidden(!overlays.hidden);
  } else if (event.key === 'Escape' && overlays.hidden) {
    setOverlaysHidden(false);
  }
});
addEventListener('click', (event) => {
  if (overlays.hidden && (event.target === canvas || p5Mount.contains(event.target))) setOverlaysHidden(false);
}, true);

function resizeCanvas() { canvas.width = innerWidth; canvas.height = innerHeight; }
addEventListener('resize', resizeCanvas);
resizeCanvas();

let sketch = null;
let mode = null;        // 'native' | 'p5'
let drawFn = null;       // native path
let p5Instance = null;   // p5 path
const vars = {};
function getVar(name) { return vars[name] ?? null; }

function setStatus() {
  statusEl.textContent = sketch ? `${sketch.name} · ${mode === 'p5' ? 'Library piece' : 'Live canvas'}` : 'Waiting for the canvas…';
  document.getElementById('audioHint').textContent = mode === 'p5'
    ? 'This library piece follows the tables. Enable the microphone now for audio-reactive pieces when they come on, or simply watch.'
    : 'Use this display’s microphone to let the piece respond to the music. Or simply watch it unfold.';
}

function teardownP5() {
  if (p5Instance) { p5Instance.remove(); p5Instance = null; }
}

function loadSketch(next, values = {}) {
  sketch = next;
  for (const name of Object.keys(vars)) delete vars[name];
  for (const v of sketch.variables || []) {
    vars[v.name] = values[v.name] ?? defaultValue(v);
  }

  if (sketch.p5Code) {
    mode = 'p5';
    drawFn = null;
    canvas.style.display = 'none';
    p5Mount.hidden = false;
    teardownP5();
    p5Instance = new window.p5((p) => {
      // host-provided contract the inherited templates were written against
      p.getSynthVar = (name) => getVar(name);
      p.getRefImage = () => null; // no upstream image pipeline in this project -- see README
      const body = new Function('p', sketch.p5Code);
      body(p);
    }, p5Mount);
  } else {
    mode = 'native';
    teardownP5();
    p5Mount.hidden = true;
    canvas.style.display = 'block';
    drawFn = null; // rebuilt lazily on the next frame
  }
  setStatus();
}

const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
const ws = new WebSocket(`${wsProto}://${location.host}/ws?role=display`);
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.type === 'sketch' && msg.sketch) {
    loadSketch(msg.sketch, msg.values);
  } else if (msg.type === 'var') {
    vars[msg.varName] = msg.value;
    // p5 templates read getVar() themselves each draw() call -- nothing else to push
  }
};
ws.onclose = () => { statusEl.textContent = 'disconnected from relay — retry by reloading'; };

// -- audio analysis: a simple energy-band heuristic, not real beat-tracking.
// Only the native contract consumes this today -- the inherited p5 template
// library predates the audio-reactivity idea. See README's next-steps.
let audioState = { level: 0, bass: 0, mid: 0, treble: 0, beat: false };
const bassHistory = [];
const audioPanel = document.getElementById('audioPanel');
const audioButton = document.getElementById('enableAudio');
const audioChip = document.getElementById('showAudio');
const audioStatus = document.getElementById('audioStatus');
document.getElementById('skipAudio').addEventListener('click', () => {
  audioPanel.hidden = true;
  audioChip.hidden = false;
  audioChip.focus();
});
audioChip.addEventListener('click', () => {
  audioPanel.hidden = false;
  audioChip.hidden = true;
  audioButton.focus();
});
audioButton.addEventListener('click', async function enable() {
  this.disabled = true;
  audioStatus.textContent = 'Waiting for microphone permission…';
  let stream;
  let actx;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    actx = new AudioContext();
    await actx.resume();
    const src = actx.createMediaStreamSource(stream);
    const analyser = actx.createAnalyser();
    analyser.fftSize = 1024;
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    audioPanel.hidden = true;
    audioChip.hidden = false;
    audioChip.textContent = 'Mic enabled';
    audioChip.dataset.live = 'true';
    this.textContent = 'Microphone enabled';
    audioStatus.textContent = 'Microphone ready. Audio-reactive pieces will follow the room.';
    audioChip.focus();

    setInterval(() => {
      analyser.getByteFrequencyData(data);
      const n = data.length;
      const band = (from, to) => {
        let sum = 0, count = 0;
        for (let i = Math.floor(n * from); i < Math.floor(n * to); i++) { sum += data[i]; count++; }
        return count ? sum / count / 255 : 0;
      };
      const bass = band(0, 0.1), mid = band(0.1, 0.4), treble = band(0.4, 1);
      const level = (bass + mid + treble) / 3;

      bassHistory.push(bass);
      if (bassHistory.length > 30) bassHistory.shift();
      const avgBass = bassHistory.reduce((a, b) => a + b, 0) / bassHistory.length;
      const beat = bass > avgBass * 1.4 && bass > 0.35;

      audioState = { level, bass, mid, treble, beat };
    }, 1000 / 30);
  } catch (err) {
    stream?.getTracks().forEach((track) => track.stop());
    if (actx) await actx.close().catch(() => {});
    this.disabled = false;
    audioStatus.textContent = 'Microphone unavailable. You can keep watching or try again.';
    console.warn('microphone unavailable — running without audio-reactivity:', err.message);
  }
});

let start = performance.now(), last = start;
function frameLoop(now) {
  const t = (now - start) / 1000;
  const dt = (now - last) / 1000;
  last = now;

  if (mode === 'native' && sketch) {
    if (!drawFn) {
      try {
        drawFn = new Function('ctx', 'frame', 'getVar', 'audio', sketch.code);
      } catch (err) {
        console.error('sketch failed to compile, drawing nothing:', err);
        drawFn = () => {};
      }
    }
    try {
      drawFn(ctx, { t, width: canvas.width, height: canvas.height, dt }, getVar, audioState);
    } catch (err) {
      // one bad frame must never kill the animation loop
      console.error('sketch runtime error on this frame:', err);
    }
  }
  // mode === 'p5': p5's own internal draw loop is already running independently
  requestAnimationFrame(frameLoop);
}
requestAnimationFrame(frameLoop);
