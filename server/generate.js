import { SKETCH_JSON_SHAPE } from '../shared/contract.js';
import { builtinSketches } from './builtin-sketches.js';
import { loadTemplateLibrary } from './templates.js';
import { validateNativeSketch } from './validate-sketch.js';
import { generationConfig } from './generation-config.js';

// Deliberately narrow: this system prompt only ever asks for Canvas2D drawing
// CODE, never an image or video generation call. That's a scope decision, not
// an oversight -- see README.md.
const SYSTEM_PROMPT = `You write short JavaScript Canvas2D drawing code for a live, shared
generative art piece running at a public event. Multiple people steer it together via knobs
mapped to your "variables", and it reacts to live music playing in the room.

VISUAL INTENT:
- Let the requested visual technique determine the drawing: a moire study needs interfering
  lines, an orbit study needs orbital motion. Do not answer every idea with the same particles.
- Translate mood into a deliberate composition, palette, and movement. Keep the result legible
  on a distant wall, with a composed first frame and a visible animation even when audio is zero.

RUNTIME CONTRACT -- your "code" field runs every animation frame as the BODY of a function
(ctx, frame, getVar, audio) => { ...your code... }. Do not include the function wrapper itself.
- ctx: CanvasRenderingContext2D, already sized to frame.width x frame.height.
- frame: { t (seconds elapsed), width, height, dt (seconds since last frame) }.
- getVar(name): returns CURRENT selected text for a choice, a number for a numeric control, or null.
- audio: { level, bass, mid, treble } each 0..1, plus audio.beat (boolean). Use these to make
  the piece visibly react to the music -- e.g. scale, rotate, spawn, or recolor on audio.bass
  or audio.beat, not just on frame.t.

RULES:
- Pure Canvas2D only. No p5.js, no external libraries, no network calls, no image/video generation.
- 2-16 variables. This is a hard limit that always applies, even if the request explicitly asks
  for more -- satisfy that intent by combining related ideas into fewer, richer controls rather
  than exceeding 16; a rejected sketch serves the room worse than a slightly consolidated one.
  Use selectable choices for categorical ideas such as palette, shape family, or motion style.
  Use numeric sliders only for real quantities such as speed, count, scale, or line width.
  Choose controls that suit the requested piece; not every variable is numeric. More variables
  is not automatically better -- reach for the fuller range when the idea genuinely calls for
  it, not as a default.
- Numeric controls have type:"number", min, max, step, and default (all numbers), and NO
  values array. Require min < max, step > 0, and max/default on the step grid from min.
  The default must be inside the range. Pick useful, finite ranges with sensible performance
  limits for a shared display. Read numbers directly: const speed = getVar('speed') ?? 0.5;
  use ?? rather than || so zero remains a valid value.
- Selectable controls have 3-10 weighted values and no numeric range fields.
- Give each variable a unique snake_case name and a short human label. Values are unique
  {text, weight} objects with weights 1, 2, or 3. Include every variable as a {{name}}
  placeholder in promptTemplate, and never refer to an undeclared placeholder.
- For categorical parameters, use lookup maps whose keys exactly match the declared value
  texts. Read each getVar once per frame and fall back to the first option if it is unknown.
  Example: const speeds = { calm: 0.2, drifting: 0.6, lively: 1.2 };
  const speed = speeds[getVar('motion')] ?? speeds.calm;
- Every knob must visibly affect a distinct part of the piece. Order choices coherently,
  from quieter to more expressive, and make the first choice an inviting starting point.
- Code must run correctly on a fresh call every frame -- there is no persistent state between
  calls, so derive everything from frame.t and audio each time (or rely on the canvas's own
  existing pixel content for trail effects, e.g. a low-alpha fillRect before drawing).
- Keep loops bounded and drawing self-contained. Use ctx.save()/ctx.restore() around
  transforms, and fill the background unless trails are intentional. No DOM access, timers,
  event listeners, imports, global state, or unfinished code. Do not emit a p5Code field.
- Respond with ONLY the JSON object below. No markdown fences, no commentary, no extra keys.

${SKETCH_JSON_SHAPE}`;

export function generationPrompt(prompt, { mode = 'create', source } = {}) {
  if (mode !== 'remix') return prompt;
  if (!source?.sketch) throw new Error('Remix requires a source sketch');
  const sketch = source.sketch;
  const sourceCount = sketch.variables?.length || 0;
  // Sources can exceed the native 16-control cap. Make consolidation explicit
  // so preserving source controls does not override the output contract.
  const capNote = sourceCount > 16
    ? ` The source below has ${sourceCount} variables, more than your 2-16 output limit allows -- you MUST consolidate, merge, or drop the least essential ones (keep whichever are most central to the piece's identity and to the requested change) rather than returning all of them. Never exceed 16 variables.`
    : '';
  return `Remix the existing piece below according to the user's instructions. Preserve its visual identity, code structure, controls, and current settings unless the requested changes require replacing them. Keep compatible variable names.${capNote} Your output's variables and promptTemplate placeholders must match each other exactly, not the source's -- if you drop or rename a variable, update or remove its placeholder in promptTemplate too. Use current settings as numeric defaults and first choices where possible. Return a COMPLETE replacement native Canvas2D sketch, never a patch.\n${sketch.p5Code ? 'The source is an inherited p5 sketch, provided only as a visual/algorithm reference. Reimplement the requested result in the native Canvas2D contract; never return p5Code or combine runtimes.' : 'The source uses the same native Canvas2D contract as your output.'}\n\nSOURCE DATA:\n${JSON.stringify({ name: sketch.name, promptTemplate: sketch.promptTemplate, variables: sketch.variables, code: sketch.code, p5Code: sketch.p5Code, currentValues: source.values })}\n\nUSER CHANGE REQUEST:\n${prompt}`;
}

function parseSketch(text) {
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```\s*$/g, '');
  return validateNativeSketch(JSON.parse(cleaned));
}

// One multi-turn call to the configured provider. `turns` alternate
// user/model roles so a repair attempt can show the model its own prior
// (broken) output as real conversation history, not just restate it in text.
async function callModel(turns, { provider, key, model, fetchImpl, timeoutMs, config }) {
  if (provider === 'gemini') {
    const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', signal: AbortSignal.timeout(timeoutMs ?? config.timeoutMs),
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
        generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 8192,
          ...(model.startsWith('gemini-3') ? { thinkingConfig: { thinkingLevel: 'LOW' } } : {}) },
      }),
    });
    if (!res.ok) throw new Error(`Gemini request failed: HTTP ${res.status}`);
    const result = await res.json();
    const candidate = result.candidates?.[0];
    if (candidate?.finishReason !== 'STOP') throw new Error('Gemini did not return a complete sketch');
    return (candidate.content?.parts || []).filter((part) => !part.thought && typeof part.text === 'string')
      .map((part) => part.text).join('\n').trim();
  }
  const res = await fetchImpl('https://api.openai.com/v1/responses', {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs ?? 45_000),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      input: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...turns.map((t) => ({ role: t.role === 'model' ? 'assistant' : 'user', content: t.text })),
      ],
      // Leave room for drawing code plus up to 16 control definitions.
      max_output_tokens: 8192,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI request failed: HTTP ${res.status}`);
  const result = await res.json();
  return (result.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === 'output_text')
    .map((item) => item.text)
    .join('\n')
    .trim();
}

export async function generateSketch(prompt, { fetchImpl = fetch, timeoutMs, env = process.env, mode = 'create', source } = {}) {
  let config;
  try {
    config = generationConfig(env);
    const { provider, key, model } = config;
    if (!key) return { ...pickFallback(), fallback: true, reason: provider === 'fallback'
      ? 'fallback mode selected' : provider === 'gemini' ? 'no Gemini key configured' : 'no OPENAI_API_KEY set' };
    const opts = { provider, key, model, fetchImpl, timeoutMs, config };
    const turns = [{ role: 'user', text: generationPrompt(prompt, { mode, source }) }];

    // The first call's own network/HTTP/timeout failures skip straight to the
    // outer catch below -- a repair pass only makes sense once we actually
    // have a model response to react to, never for a connectivity problem.
    const text = await callModel(turns, opts);
    try {
      const sketch = parseSketch(text);
      return { ...sketch, id: randomId(), fallback: false, generation: { provider, model } };
    } catch (invalid) {
      // One repair pass: hand the model its own broken output plus the exact
      // validation error and ask for a targeted fix. Far more likely to
      // succeed than silently repeating the identical request, which tends
      // to reproduce the identical mistake.
      console.warn('[generate] first attempt failed validation, retrying with a repair prompt:', invalid.message);
      turns.push({ role: 'model', text });
      turns.push({ role: 'user', text: `That response failed validation: ${invalid.message}. Return a corrected, COMPLETE replacement JSON sketch that fixes this specific problem -- keep the rest of the sketch (visual concept, code, other variables) the same wherever possible. Respond with ONLY the corrected JSON object, no markdown fences, no commentary.` });
      const repairedText = await callModel(turns, opts);
      const sketch = parseSketch(repairedText);
      return { ...sketch, id: randomId(), fallback: false, generation: { provider, model } };
    }
  } catch (err) {
    const reason = config?.key ? err.message.replaceAll(config.key, '[redacted]') : err.message;
    console.warn('[generate] falling back to a built-in sketch:', reason);
    return { ...pickFallback(), fallback: true, reason };
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
