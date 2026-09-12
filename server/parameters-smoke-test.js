import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createRelay } from './relay.js';
import { relayClients } from './relay-smoke-test.js';
import { validateNativeSketch } from './validate-sketch.js';
import { defaultValue, numericValue } from '../client/shared/parameters.js';

export async function checkParameters() {
  const speed = { name: 'speed', label: 'Speed', type: 'number', min: -1, max: 1, step: 0.1, default: 0 };
  const sketch = {
    name: 'Parameter test', promptTemplate: '{{palette}} at {{speed}}',
    variables: [
      { name: 'palette', label: 'Palette', values: ['0', 'coral', 'cyan'].map((text) => ({ text, weight: 1 })) }, speed,
    ], code: 'ctx.fillRect(0, 0, frame.width, frame.height);',
  };
  assert.deepEqual(validateNativeSketch(sketch), sketch);
  assert.equal(defaultValue(speed), 0);
  assert.equal(defaultValue(sketch.variables[0]), '0', 'numeric-looking choices stay categorical');
  assert.equal(numericValue(speed, 0.26), 0.3);
  for (const value of ['0.3', null, NaN, Infinity, -2, 2]) assert.equal(numericValue(speed, value), null);
  for (const overrides of [
    { min: 1 }, { max: Infinity }, { step: 0 }, { step: -1 }, { step: 3 },
    { default: 2 }, { default: '0' }, { default: 0.05 }, { values: [] }, { type: 'color' },
  ]) {
    assert.throws(() => validateNativeSketch({ ...sketch, variables: [sketch.variables[0], { ...speed, ...overrides }] }));
  }
  const server = http.createServer();
  const relay = createRelay(server);
  relay.setSketch(sketch);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { connect, close } = relayClients(`http://127.0.0.1:${server.address().port}`);
  try {
    const a = connect('role=station&table=number-a');
    const b = connect('role=station&table=number-b');
    const display = connect('role=display');
    const first = await a.next('welcome');
    assert.equal(first.values.speed, 0);
    const second = await b.next('welcome');
    assert.equal(second.owners.speed[0].id, second.participantId);
    await display.next('sketch');
    for (const value of ['0.2', null, 2, -2]) b.send('speed', value);
    b.send('speed', 0.26);
    for (const client of [a, b, display]) assert.equal((await client.next('var')).value, 0.3);
    assert.equal(relay.getTelemetry().changesByTable['number-b'], 1);
    a.send('speed', 0.5);
    assert.equal((await a.next('not_owner')).value, 0.3);
    const late = connect('role=display');
    assert.equal((await late.next('sketch')).values.speed, 0.3);
    b.send('speed', 0);
    for (const client of [a, b, display, late]) assert.equal((await client.next('var')).value, 0);
    a.send('palette', '0');
    for (const client of [a, b, display, late]) assert.equal((await client.next('var')).value, '0');
    relay.setSketch(sketch);
    for (const client of [a, b, display, late]) assert.equal((await client.next('sketch')).values.speed, 0);
  } finally {
    close();
    await new Promise((resolve) => server.close(resolve));
  }
}

