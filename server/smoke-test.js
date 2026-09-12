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
import assert from 'node:assert/strict';
import { loadTemplateLibrary } from './templates.js';
import { pickFallback } from './generate.js';
import { checkRelay } from './relay-smoke-test.js';

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

const server = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), OPENAI_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverOutput = '';
server.stdout.on('data', (d) => { serverOutput += d; });
server.stderr.on('data', (d) => { serverOutput += d; });

async function waitForServer(timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/telemetry`);
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

  await checkAsync('stations and displays share remixes, values, late joins, and four-second ownership', () => checkRelay(`http://127.0.0.1:${PORT}`));

  await checkAsync('GET /api/telemetry returns the expected shape', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/telemetry`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.activeTables), 'activeTables should be an array');
    assert.equal(typeof body.msSinceLastActivity, 'number');
    assert.equal(typeof body.changesByTable, 'object');
  });

  await checkAsync('POST /api/generate with no API key falls back cleanly', async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/generate`, {
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
    const res = await fetch(`http://127.0.0.1:${PORT}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });
} finally {
  server.kill();
}

console.log('');
if (failed) {
  console.error('Smoke test FAILED -- see the FAIL lines above.');
  process.exit(1);
} else {
  console.log('Smoke test passed.');
  process.exit(0);
}
