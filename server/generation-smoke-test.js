import assert from 'node:assert/strict';
import { validateNativeSketch } from './validate-sketch.js';
import { generateSketch } from './generate.js';

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

    for (const text of ['not JSON', JSON.stringify({ ...valid, p5Code: 'p.draw = () => {}' }), JSON.stringify({ ...valid, code: 'const broken = ;' })]) {
      const fallback = await generate('an orbit', { fetchImpl: transport(text) });
      assert.equal(fallback.fallback, true);
      assert.ok(fallback.code || fallback.p5Code);
    }
    const failed = await generate('an orbit', { fetchImpl: async () => ({ ok: false, status: 503 }) });
    assert.equal(failed.fallback, true);
    assert.match(failed.reason, /HTTP 503/);
    const timedOut = await generate('an orbit', {
      timeoutMs: 5,
      fetchImpl: async (_url, { signal }) => new Promise((resolve, reject) => {
        const watchdog = setTimeout(() => reject(new Error('abort was not delivered')), 1000);
        signal.addEventListener('abort', () => { clearTimeout(watchdog); reject(signal.reason); }, { once: true });
      }),
    });
    assert.equal(timedOut.fallback, true);
    assert.match(timedOut.reason, /timeout/i);
    assert.equal(warnings, 5);
  } finally {
    console.warn = originalWarn;

  }
}
