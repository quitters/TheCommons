// Hand-written fallback sketches, used whenever no OPENAI_API_KEY is set or a
// generation call fails. They exist so the whole pipeline -- station knobs,
// relay, display, audio-reactivity -- is provably real and demoable before a
// single API key is configured, and so a live demo never goes fully dark if a
// generation call has a bad moment.

export const builtinSketches = [
  {
    name: 'Pulse Field',
    promptTemplate: 'a {{palette}} field of pulsing circles reacting to the music',
    variables: [
      {
        name: 'palette', label: 'Palette',
        values: [
          { text: 'sunset', weight: 1 },
          { text: 'ocean', weight: 1 },
          { text: 'neon', weight: 1 },
        ],
      },
      {
        name: 'density', label: 'Density',
        values: [
          { text: 'sparse', weight: 1 },
          { text: 'dense', weight: 1 },
        ],
      },
    ],
    code: `
const PALETTES = {
  sunset: ['#ff6b6b', '#ffa94d', '#ffd43b'],
  ocean:  ['#1c7ed6', '#22b8cf', '#63e6be'],
  neon:   ['#f06595', '#845ef7', '#22b8cf'],
};
const pal = PALETTES[getVar('palette')] || PALETTES.sunset;
const dense = getVar('density') === 'dense';
const n = dense ? 60 : 24;
ctx.fillStyle = 'rgba(10,10,15,0.15)';
ctx.fillRect(0, 0, frame.width, frame.height);
for (let i = 0; i < n; i++) {
  const a = (i / n) * Math.PI * 2 + frame.t * 0.3;
  const r = Math.min(frame.width, frame.height) * (0.15 + 0.25 * Math.sin(frame.t * 0.5 + i));
  const x = frame.width / 2 + Math.cos(a) * r;
  const y = frame.height / 2 + Math.sin(a) * r;
  const boost = 1 + audio.bass * 2 + (audio.beat ? 0.8 : 0);
  const size = (6 + 10 * audio.level) * boost;
  ctx.fillStyle = pal[i % pal.length];
  ctx.beginPath();
  ctx.arc(x, y, size, 0, Math.PI * 2);
  ctx.fill();
}
`.trim(),
  },
  {
    name: 'Grid Wave',
    promptTemplate: 'a {{palette}} grid rippling with the beat, {{motion}}',
    variables: [
      {
        name: 'palette', label: 'Palette',
        values: [
          { text: 'mono', weight: 1 },
          { text: 'candy', weight: 1 },
        ],
      },
      {
        name: 'motion', label: 'Motion',
        values: [
          { text: 'calm', weight: 1 },
          { text: 'frantic', weight: 1 },
        ],
      },
    ],
    code: `
ctx.fillStyle = '#0a0a0f';
ctx.fillRect(0, 0, frame.width, frame.height);
const cols = 16, rows = 10;
const cw = frame.width / cols, ch = frame.height / rows;
const speed = getVar('motion') === 'frantic' ? 3 : 1;
const candy = getVar('palette') === 'candy';
for (let y = 0; y < rows; y++) {
  for (let x = 0; x < cols; x++) {
    const phase = (x + y) * 0.4 + frame.t * speed;
    const wave = Math.sin(phase) * 0.5 + 0.5;
    const boosted = Math.min(1, wave + audio.mid * 0.6 + (audio.beat ? 0.4 : 0));
    const hue = candy ? (x * 20 + y * 15 + frame.t * 20) % 360 : 220;
    ctx.fillStyle = \`hsl(\${hue}, 70%, \${10 + boosted * 50}%)\`;
    const pad = 2;
    ctx.fillRect(x * cw + pad, y * ch + pad, cw - pad * 2, ch - pad * 2);
  }
}
`.trim(),
  },
];
