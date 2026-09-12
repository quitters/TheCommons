import { SKETCH_JSON_SHAPE } from '../shared/contract.js';
import { builtinSketches } from './builtin-sketches.js';
import { loadTemplateLibrary } from './templates.js';

// Deliberately narrow: this system prompt only ever asks for Canvas2D drawing
// CODE, never an image or video generation call. That's a scope decision, not
// an oversight -- see README.md.
const SYSTEM_PROMPT = `You write short JavaScript Canvas2D drawing code for a live, shared
generative art piece running at a public event. Multiple people steer it together via knobs
mapped to your "variables", and it reacts to live music playing in the room.

RUNTIME CONTRACT -- your "code" field runs every animation frame as the BODY of a function
(ctx, frame, getVar, audio) => { ...your code... }. Do not include the function wrapper itself.
- ctx: CanvasRenderingContext2D, already sized to frame.width x frame.height.
- frame: { t (seconds elapsed), width, height, dt (seconds since last frame) }.
- getVar(name): returns the CURRENT selected value's text for a variable you declared, or null.
- audio: { level, bass, mid, treble } each 0..1, plus audio.beat (boolean). Use these to make
  the piece visibly react to the music -- e.g. scale, rotate, spawn, or recolor on audio.bass
  or audio.beat, not just on frame.t.

RULES:
- Pure Canvas2D only. No p5.js, no external libraries, no network calls, no image/video generation.
- 2-6 variables, each with 3-6 weighted values. Bind them to the most visually expressive
  parameters (palette, shape family, motion style, density) via getVar.
- Code must run correctly on a fresh call every frame -- there is no persistent state between
  calls, so derive everything from frame.t and audio each time (or rely on the canvas's own
  existing pixel content for trail effects, e.g. a low-alpha fillRect before drawing).
- Respond with ONLY the JSON object below. No markdown fences, no commentary, no extra keys.

${SKETCH_JSON_SHAPE}`;

const MODEL = process.env.MODEL || 'gpt-5.6-sol';

export async function generateSketch(prompt) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return { ...pickFallback(), fallback: true, reason: 'no OPENAI_API_KEY set' };
  }
  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        input: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        max_output_tokens: 2048,
      }),
    });
    if (!res.ok) throw new Error(`OpenAI request failed: HTTP ${res.status}`);
    const result = await res.json();
    const text = (result.output ?? [])
      .flatMap((item) => item.content ?? [])
      .filter((item) => item.type === 'output_text')
      .map((item) => item.text)
      .join('\n')
      .trim();
    const cleaned = text.replace(/^```(?:json)?\s*|\s*```\s*$/g, '');
    const sketch = JSON.parse(cleaned);
    if (!sketch.code || !Array.isArray(sketch.variables)) {
      throw new Error('model response missing code/variables');
    }
    return { ...sketch, id: randomId(), fallback: false };
  } catch (err) {
    console.warn('[generate] falling back to a built-in sketch:', err.message);
    return { ...pickFallback(), fallback: true, reason: err.message };
  }
}

// The fallback pool spans both contracts: the two hand-written native
// (ctx/frame/getVar/audio) sketches, plus the full inherited p5.js template
// library (see server/templates.js) -- the display runtime (client/display)
// runs either kind, so a generation failure still lands on something rich
// rather than always the same two defaults.
export function pickFallback() {
  const pool = [...builtinSketches, ...loadTemplateLibrary()];
  const idx = Math.floor(Math.random() * pool.length);
  return { ...pool[idx], id: randomId() };
}

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}
