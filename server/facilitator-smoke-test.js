import assert from 'node:assert/strict';
import { startFacilitator } from './facilitator.js';

export async function checkFacilitator() {
  let time = 0, current = {}, tick, resolve, calls = 0, cancelled = false;
  let activity = 100_000;
  const relay = { getSketch: () => current, setSketch: (sketch) => { current = sketch; },
    getTelemetry: () => ({ msSinceLastActivity: activity, changesByTable: {} }) };
  const oldLog = console.log;
  console.log = () => {};
  const stop = startFacilitator(relay, {
    now: () => time,
    schedule: (callback) => { tick = callback; return 1; },
    cancel: () => { cancelled = true; },
    generate: () => { calls++; return new Promise((done) => { resolve = done; }); },
  });
  try {
    await tick();
    assert.equal(calls, 0);
    time = 90_000;
    const first = tick();
    await tick();
    assert.equal(calls, 1, 'a pending request must not overlap');
    const sketch = {};
    resolve(sketch); await first;
    assert.equal(current, sketch);
    time = 100_000; await tick();
    assert.equal(calls, 1, 'continued silence must not trigger every ten seconds');
    time = 180_000;
    activity = 0; await tick();
    assert.equal(calls, 1, 'active tables should keep their piece');
    activity = 100_000;
    const second = tick();
    const manual = {};
    current = manual;
    resolve({}); await second;
    assert.equal(current, manual, 'manual remixes win over a stale generation');
    time = 190_000; await tick();
    assert.equal(calls, 2);
    time = 280_000;
    const third = tick();
    stop(); resolve({}); await third;
    assert.equal(current, manual, 'stop must prevent pending publication');
    assert.equal(cancelled, true);
  } finally { stop(); console.log = oldLog; }
}
