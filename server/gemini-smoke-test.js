import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateSketch } from './generate.js';
import { generationConfig } from './generation-config.js';
import { builtinSketches } from './builtin-sketches.js';

export async function checkGemini() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commons-gemini-test-'));
  const configPath = path.join(dir, 'key.json');
  const key = 'dummy-gemini-key-not-a-credential';
  fs.writeFileSync(configPath, JSON.stringify({ api_key: key }));
  const env = { GENERATION_PROVIDER: 'gemini', GEMINI_CONFIG_PATH: configPath };
  const oldWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(generationConfig(env).key, key);
    assert.equal(generationConfig({ ...env, GEMINI_API_KEY: 'override' }).key, 'override');
    assert.equal(generationConfig({ GENERATION_PROVIDER: 'fallback', GEMINI_CONFIG_PATH: 'missing' }).key, '');
    assert.throws(() => generationConfig({ ...env, GEMINI_CONFIG_PATH: 'missing' }), /could not read/);
    const sketch = builtinSketches[0];
    const parts = [{ thought: true, text: 'ignore this thought part' }, { text: JSON.stringify(sketch) }];
    let calls = 0;
    const generated = await generateSketch('a luminous orbit', { env, fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent');
      assert.equal(options.headers['x-goog-api-key'], key);
      assert.ok(!url.includes(key));
      const body = JSON.parse(options.body);
      assert.equal(body.generationConfig.responseMimeType, 'application/json');
      assert.equal(body.generationConfig.maxOutputTokens, 8192);
      assert.equal(body.contents[0].parts[0].text, 'a luminous orbit');
      assert.equal(body.tools, undefined);
      return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts } }] }) };
    } });
    assert.equal(calls, 1);
    assert.equal(generated.fallback, false);
    assert.equal(generated.generation.provider, 'gemini');
    assert.equal(generated.variables[1].type, 'number');
    assert.equal(generated.variables[0].values[0].text, 'sunset');
    assert.ok(!JSON.stringify(generated).includes(key));
    const broken = JSON.stringify({ ...sketch, code: 'const broken = ;' });
    let validationError;
    try { new Function('ctx', 'frame', 'getVar', 'audio', 'const broken = ;'); } catch (error) { validationError = error.message; }
    const requests = [];
    const repaired = await generateSketch('a luminous orbit', { env, fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      const text = requests.length === 1 ? broken : JSON.stringify(sketch);
      return { ok: true, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] }) };
    } });
    assert.equal(repaired.fallback, false);
    assert.equal(repaired.code, sketch.code);
    assert.equal(repaired.p5Code, undefined);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1].systemInstruction, requests[0].systemInstruction);
    assert.deepEqual(requests[1].contents.map((turn) => turn.role), ['user', 'model', 'user']);
    assert.deepEqual(requests[1].contents[0], requests[0].contents[0]);
    assert.equal(requests[1].contents[1].parts[0].text, broken);
    assert.ok(requests[1].contents[2].parts[0].text.includes(validationError));
    assert.match(requests[1].contents[2].parts[0].text, /COMPLETE replacement JSON/);
    for (const result of [
      { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts } }] },
      { promptFeedback: { blockReason: 'SAFETY' } },
      { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'bad JSON' }] } }] },
    ]) {
      let attempts = 0;
      const fallback = await generateSketch('test', { env, fetchImpl: async () => { attempts++; return { ok: true, json: async () => result }; } });
      assert.equal(fallback.fallback, true);
      assert.equal(attempts, result.candidates?.[0]?.finishReason === 'STOP' ? 2 : 1);
    }
    const noKey = await generateSketch('test', { env: { GENERATION_PROVIDER: 'gemini' },
      fetchImpl: () => { throw new Error('must not fetch without a key'); } });
    assert.match(noKey.reason, /no Gemini key/);
    const failure = await generateSketch('test', { env, fetchImpl: async () => { throw new Error(`failed with ${key}`); } });
    assert.ok(!JSON.stringify(failure).includes(key));
    assert.match(failure.reason, /redacted/);
  } finally {
    console.warn = oldWarn;
    fs.unlinkSync(configPath);
    fs.rmdirSync(dir);
  }
}
