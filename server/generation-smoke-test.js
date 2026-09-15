import assert from 'node:assert/strict';
import { validateNativeSketch } from './validate-sketch.js';
import { generateSketch, generationPrompt } from './generate.js';

const fixture = () => ({
  name: 'Orbit Study',
  promptTemplate: 'An orbit in {{palette}}, moving {{motion}}',
  variables: [
    { name: 'palette', label: 'Palette', values: ['coral', 'cyan', 'mono'].map((text) => ({ text, weight: 1 })) },
    { name: 'motion', label: 'Motion', values: ['calm', 'drifting', 'lively'].map((text) => ({ text, weight: 2 })) },
  ],
  code: 'ctx.fillRect(0, 0, frame.width, frame.height);',
});

export async function checkGeneration() {
  const valid = fixture();
  assert.deepEqual(validateNativeSketch(valid), valid);
  const controls = (count) => {
    const sketch = fixture();
    sketch.variables = Array.from({ length: count }, (_, i) => ({ ...fixture().variables[0], name: `control_${i}`, label: `Control ${i}` }));
    sketch.promptTemplate = sketch.variables.map((v) => `{{${v.name}}}`).join(' ');
    return sketch;
  };
  assert.deepEqual(validateNativeSketch(controls(16)), controls(16));
  assert.throws(() => validateNativeSketch(controls(17)), /expected 2–16 variables/);
  const oversizedSource = { sketch: { ...controls(17), p5Code: 'p.draw = () => {};' }, values: {} };
  assert.equal(generationPrompt('fresh idea', { mode: 'create', source: oversizedSource }), 'fresh idea');
  assert.match(generationPrompt('adjust the colors', { mode: 'remix', source: oversizedSource }), /MUST consolidate/);
  assert.doesNotMatch(generationPrompt('adjust the colors', { mode: 'remix', source: { sketch: controls(16), values: {} } }), /MUST consolidate/);
  const choices = fixture();
  choices.variables[0].values = Array.from({ length: 10 }, (_, i) => ({ text: `Color ${i}`, weight: 1 }));
  assert.deepEqual(validateNativeSketch(choices), choices);
  choices.variables[0].values.push({ text: 'Color 10', weight: 1 });
  assert.throws(() => validateNativeSketch(choices), /palette needs 3–10 choices/);
  const normalized = fixture();
  delete normalized.variables[0].label;
  delete normalized.variables[0].values[0].weight;
  assert.equal(validateNativeSketch(normalized).variables[0].values[0].weight, 1);
  assert.equal(validateNativeSketch(normalized).variables[0].label, 'palette');
  const invalidCases = [
    (s) => { s.p5Code = 'p.draw = () => {};'; },
    (s) => { s.name = ''; },
    (s) => { s.variables = []; },
    (s) => { s.variables[1].name = s.variables[0].name; },
    (s) => { s.variables[0].name = '__proto__'; },
    (s) => { s.variables[0].values = ['coral', 'cyan', 'mono']; },
    (s) => { s.variables[0].values[1].text = 'coral'; },
    (s) => { s.variables[0].values[0].weight = -1; },
    (s) => { s.variables[0].values[0].text = 42; },
    (s) => { s.promptTemplate = '{{palette}} {{missing}}'; },
    (s) => { s.promptTemplate += ' {{bad-key}}'; },
    (s) => { s.code = 'const broken = ;'; },
  ];
  for (const corrupt of invalidCases) {
    const sketch = fixture();
    corrupt(sketch);
    assert.throws(() => validateNativeSketch(sketch));
  }
  for (const value of [null, [], 'sketch']) assert.throws(() => validateNativeSketch(value));

  const testEnv = { GENERATION_PROVIDER: 'openai', OPENAI_API_KEY: '' };
  const generate = (prompt, options) => generateSketch(prompt, { env: testEnv, ...options });
  const originalWarn = console.warn;
  let warnings = 0;
  console.warn = () => { warnings++; };
  try {
    testEnv.OPENAI_API_KEY = '';
    const noKey = await generate('an orbit', { fetchImpl: () => { throw new Error('no-key path must not call fetch'); } });
    assert.equal(noKey.fallback, true);
    assert.match(noKey.reason, /no OPENAI_API_KEY/);

    // Always inject a fake transport with the dummy key: no paid calls in verify.
    testEnv.OPENAI_API_KEY = 'smoke-test-dummy-key';
    const transport = (text) => async () => ({
      ok: true,
      json: async () => ({ output: [{ content: [{ type: 'output_text', text }] }] }),
    });
    const generated = await generate('an orbit', { fetchImpl: transport('```json\n' + JSON.stringify(valid) + '\n```') });
    assert.equal(generated.fallback, false);
    assert.equal(generated.code, valid.code);
    assert.ok(generated.id);
    assert.equal(generated.p5Code, undefined);

    // Each of these fails validation on every attempt (the mocked transport
    // always returns the same broken text, regardless of the repair turns
    // added to the conversation), so it exercises the repair pass and still
    // ends up on the fallback pool -- two warnings apiece (retry, then fall back).
    for (const text of ['not JSON', JSON.stringify({ ...valid, p5Code: 'p.draw = () => {}' }), JSON.stringify({ ...valid, code: 'const broken = ;' })]) {
      let calls = 0;
      const fallback = await generate('an orbit', { fetchImpl: async (...args) => { calls++; return transport(text)(...args); } });
      assert.equal(fallback.fallback, true);
      assert.ok(fallback.code || fallback.p5Code);
      assert.equal(calls, 2);
    }

    // The repair pass actually recovering: broken JSON on the first call,
    // a valid sketch on the second -- confirms a fixable mistake no longer
    // costs the room a real generation.
    let repairCalls = 0;
    const repairRequests = [];
    const repairableTransport = async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      repairRequests.push(JSON.parse(options.body));
      repairCalls++;
      const text = repairCalls === 1 ? 'not JSON at all' : '```json\n' + JSON.stringify(valid) + '\n```';
      return { ok: true, json: async () => ({ output: [{ content: [{ type: 'output_text', text }] }] }) };
    };
    const repaired = await generate('an orbit', { fetchImpl: repairableTransport });
    assert.equal(repaired.fallback, false);
    assert.equal(repaired.code, valid.code);
    assert.equal(repairCalls, 2);
    assert.equal(repairRequests[0].max_output_tokens, 8192);
    assert.deepEqual(repairRequests[1].input.map((turn) => turn.role), ['system', 'user', 'assistant', 'user']);
    assert.deepEqual(repairRequests[1].input.slice(0, 2), repairRequests[0].input);
    assert.equal(repairRequests[1].input[2].content, 'not JSON at all');
    let jsonError;
    try { JSON.parse('not JSON at all'); } catch (error) { jsonError = error.message; }
    assert.ok(repairRequests[1].input[3].content.includes(jsonError));
    assert.match(repairRequests[1].input[3].content, /COMPLETE replacement JSON/);

    let failureCalls = 0;
    const failed = await generate('an orbit', { fetchImpl: async () => { failureCalls++; return { ok: false, status: 503 }; } });
    assert.equal(failed.fallback, true);
    assert.match(failed.reason, /HTTP 503/);
    assert.equal(failureCalls, 1);
    let timeoutCalls = 0;
    const timedOut = await generate('an orbit', {
      timeoutMs: 5,
      fetchImpl: async (_url, { signal }) => new Promise((resolve, reject) => {
        timeoutCalls++;
        const watchdog = setTimeout(() => reject(new Error('abort was not delivered')), 1000);
        signal.addEventListener('abort', () => { clearTimeout(watchdog); reject(signal.reason); }, { once: true });
      }),
    });
    assert.equal(timedOut.fallback, true);
    assert.match(timedOut.reason, /timeout/i);
    assert.equal(timeoutCalls, 1);
    let networkCalls = 0;
    const networkFailure = await generate('an orbit', { fetchImpl: async () => { networkCalls++; throw new Error('connection reset'); } });
    assert.equal(networkFailure.fallback, true);
    assert.equal(networkCalls, 1);
    // 3 fallback cases above x 2 warnings (retry + fall back) + 1 for the
    // successful repair (retry only, no fall-back warning) + HTTP + timeout + network.
    assert.equal(warnings, 10);
  } finally {
    console.warn = originalWarn;

  }
}
