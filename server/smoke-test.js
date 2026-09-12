// Smoke test: boots the real server on a dedicated test port, hits its API,
// and directly exercises the template-loading and generation-fallback logic.
// No test framework, no new dependency -- consistent with the rest of this
// project. Exits 0 on pass, 1 with a clear message on the first failure.
//
// Deliberately forces OPENAI_API_KEY empty for the live-server checks, so
// this test is deterministic and never makes a real API call -- it proves
// the zero-config fallback path, which is the path any hackathon judge
// running a clean clone will actually exercise first.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { loadTemplateLibrary } from './templates.js';
import { pickFallback } from './generate.js';
import { checkRelay } from './relay-smoke-test.js';
import { checkGeneration } from './generation-smoke-test.js';
import { checkParameters } from './parameters-smoke-test.js';
import { checkGemini } from './gemini-smoke-test.js';
import { checkFacilitator } from './facilitator-smoke-test.js';
import { checkGenerationJobs } from './generation-jobs-smoke-test.js';
import { checkOwnership } from './ownership-smoke-test.js';

let adminCookie = '';
const apiFetch = (url, options = {}) => fetch(url, { ...options, headers: { ...options.headers, ...(adminCookie ? { Cookie: adminCookie } : {}) } });
const PORT = 4199; // dedicated test port, distinct from the dev default (4173)
let failed = false;

function check(name, fn) {
  try {
    fn();
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed = true;
    console.error(`  FAIL - ${name}`);
    console.error(`    ${err.message}`);
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed = true;
    console.error(`  FAIL - ${name}`);
    console.error(`    ${err.message}`);
  }
}

console.log('The Commons -- smoke test\n');

console.log('In-process checks (template library + fallback pool):');

check('inherited template library loads at least one template', () => {
  const lib = loadTemplateLibrary();
  assert.ok(Array.isArray(lib) && lib.length > 0, `expected a non-empty array, got ${lib?.length}`);
});

check('every loaded template has p5Code, a name, and a variables array', () => {
  for (const t of loadTemplateLibrary()) {
    assert.ok(typeof t.p5Code === 'string' && t.p5Code.length > 0, `${t.id} missing p5Code`);
    assert.ok(typeof t.name === 'string' && t.name.length > 0, `${t.id} missing name`);
    assert.ok(Array.isArray(t.variables), `${t.id} missing variables array`);
  }
});

check('the SVG-renderer template is excluded from the auto-picked pool', () => {
  const ids = loadTemplateLibrary().map((t) => t.id);
  assert.ok(!ids.includes('svg-flow-particles'), 'svg-flow-particles should be excluded -- see server/templates.js EXCLUDED set');
});

check('pickFallback() returns a valid sketch from the combined native+p5 pool', () => {
  const sketch = pickFallback();
  assert.ok(sketch && Array.isArray(sketch.variables), 'pickFallback() did not return a sketch with a variables array');
  assert.ok(sketch.code || sketch.p5Code, 'pickFallback() sketch has neither code nor p5Code');
});

console.log('\nLive server checks (spawns the real server on a test port):');

await checkAsync('native generation validates controls and syntax, with safe no-key/error/timeout fallback', checkGeneration);
await checkAsync('numeric controls preserve bounds, steps, zero, ownership, and late-join state', checkParameters);
await checkAsync('Gemini uses server-only credentials and validates text-only sketches without real model calls', checkGemini);
await checkAsync('facilitator respects cooldown, in-flight requests, manual remixes, and stop', checkFacilitator);
await checkAsync('generation jobs survive reconnects and restart without duplicate model calls', checkGenerationJobs);
await checkAsync('automatic ownership shares excess participants, survives reloads, and adapts to replacement controls', checkOwnership);

const jobDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'commons-live-test-'));
const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), GENERATION_PROVIDER: 'fallback',
    OPENAI_API_KEY: '', GEMINI_API_KEY: '', GEMINI_CONFIG_PATH: '', FACILITATOR_ENABLED: 'false', GENERATION_DATA_DIR: jobDirectory, ADMIN_PASSWORD: 'test-admin-password' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverOutput = '';
server.stdout.on('data', (d) => { serverOutput += d; });
server.stderr.on('data', (d) => { serverOutput += d; });

async function waitForServer(timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await apiFetch(`http://127.0.0.1:${PORT}/api/telemetry`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server did not become ready within ${timeoutMs}ms.\nOutput so far:\n${serverOutput}`);
}

try {
  await waitForServer();
  await checkAsync('participant requests cannot remix or access jobs; admin signs in securely', async () => {
    for (const route of ['/api/generate', '/api/generations']) {
      const response = await fetch(`http://127.0.0.1:${PORT}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'blocked' }) });
      assert.equal(response.status, 401);
    }
    assert.equal((await fetch(`http://127.0.0.1:${PORT}/api/generations/active`)).status, 401);
    const incorrect = await fetch(`http://127.0.0.1:${PORT}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'wrong' }) });
    assert.equal(incorrect.status, 401);
    const login = await fetch(`http://127.0.0.1:${PORT}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test-admin-password' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
    adminCookie = cookie.split(';')[0];
  });

  await checkAsync('stations and displays share remixes, values, late joins, and individual ownership', () => checkRelay(`http://127.0.0.1:${PORT}`, { Cookie: adminCookie }));

  await checkAsync('GET /api/telemetry returns the expected shape', async () => {
    const res = await apiFetch(`http://127.0.0.1:${PORT}/api/telemetry`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.activeTables), 'activeTables should be an array');
    assert.equal(typeof body.msSinceLastActivity, 'number');
    assert.equal(typeof body.changesByTable, 'object');
  });

  await checkAsync('POST /api/generate with no API key falls back cleanly', async () => {
    const res = await apiFetch(`http://127.0.0.1:${PORT}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'a calm blue field' }),
    });
    assert.equal(res.status, 200);
    const sketch = await res.json();
    assert.equal(sketch.fallback, true, 'expected fallback:true with no OPENAI_API_KEY set');
    assert.ok(sketch.code || sketch.p5Code, 'fallback sketch has neither code nor p5Code');
    assert.ok(Array.isArray(sketch.variables) && sketch.variables.length > 0, 'fallback sketch has no variables');
  });

  await checkAsync('POST /api/generate with no prompt is rejected with 400', async () => {
    const res = await apiFetch(`http://127.0.0.1:${PORT}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });

  await checkAsync('POST /api/generate rejects non-text, whitespace, and oversized prompts', async () => {
    for (const prompt of [123, {}, '   ', 'x'.repeat(2001)]) {
      const res = await apiFetch(`http://127.0.0.1:${PORT}/api/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      assert.equal(res.status, 400);
    }
  });
  await checkAsync('async remix API accepts promptly and reuses a request ID after reconnect', async () => {
    const requestId = 'e93af908-b591-46aa-95a4-55aa5f598d56';
    const body = JSON.stringify({ prompt: 'a room-wide async remix', requestId });
    const first = await apiFetch(`http://127.0.0.1:${PORT}/api/generations`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    });
    assert.equal(first.status, 202);
    const job = await first.json();
    assert.equal(job.id, requestId);
    for (let i = 0; i < 30; i++) {
      const status = await (await apiFetch(`http://127.0.0.1:${PORT}/api/generations/${job.id}`)).json();
      if (status.status === 'fallback') break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const retried = await (await apiFetch(`http://127.0.0.1:${PORT}/api/generations`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    })).json();
    assert.equal(retried.status, 'fallback');
    assert.equal(retried.id, requestId);
    assert.ok(retried.sketch.code || retried.sketch.p5Code);
  });
} finally {
  const stopped = once(server, 'exit');
  server.kill();
  await stopped;
  for (const filename of fs.readdirSync(jobDirectory)) fs.unlinkSync(path.join(jobDirectory, filename));
  fs.rmdirSync(jobDirectory);
}

console.log('');
if (failed) {
  console.error('Smoke test FAILED -- see the FAIL lines above.');
  process.exit(1);
} else {
  console.log('Smoke test passed.');
  process.exit(0);
}
