import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createRelay } from './relay.js';
import { relayClients } from './relay-smoke-test.js';

export async function checkOwnership() {
  const server = http.createServer();
  const relay = createRelay(server, { disconnectGraceMs: 50 });
  const choices = { name: 'palette', values: ['a', 'b', 'c'].map((text) => ({ text })) };
  const number = { name: 'speed', type: 'number', min: 0, max: 1, step: 0.1, default: 0.5 };
  relay.setSketch({ name: 'First', variables: [choices, number], code: '' });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const { connect, close } = relayClients(`http://127.0.0.1:${server.address().port}`);
  try {
    const a = connect('role=station&table=A'); const wa = await a.next('welcome');
    const b = connect('role=station&table=B'); const wb = await b.next('welcome');
    const c = connect('role=station&table=C'); const wc = await c.next('welcome');
    assert.deepEqual(wc.owners.palette.map((person) => person.id), [wa.participantId, wc.participantId]);
    assert.equal(wc.owners.speed[0].id, wb.participantId);
    a.send('palette', 'b');
    for (const client of [a, b, c]) assert.equal((await client.next('var')).value, 'b');
    c.send('palette', 'c');
    const held = await c.next('held');
    assert.equal(held.value, 'b');
    assert.ok(held.until > Date.now());
    b.send('palette', 'c');
    assert.equal((await b.next('not_owner')).value, 'b');
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, held.until - Date.now()) + 20));
    c.send('palette', 'c');
    for (const client of [a, b, c]) assert.equal((await client.next('var')).value, 'c');
    const resumed = connect(`role=station&table=renamed&session=${wa.session}`);
    const wr = await resumed.next('welcome');
    assert.equal(wr.participantId, wa.participantId);
    assert.equal(wr.table, 'A');
    assert.equal(wr.owners.palette.length, 2, 'reload is not another participant');
    a.ws.terminate();
    relay.setSketch({ name: 'Entirely new controls', code: '', variables: [
      { name: 'width', type: 'number', min: 2, max: 10, step: 2, default: 4 },
      { name: 'shape', values: [{ text: 'ribbon' }, { text: 'ring' }] },
      { name: 'turn', type: 'number', min: -1, max: 1, step: 0.5, default: 0 },
    ] });
    for (const client of [resumed, b, c]) {
      const next = await client.next('sketch');
      assert.deepEqual(next.values, { width: 4, shape: 'ribbon', turn: 0 });
      assert.deepEqual(Object.keys(next.owners), ['width', 'shape', 'turn']);
      assert.ok(Object.values(next.owners).every((group) => group.length === 1));
    }
    c.ws.terminate();
    await new Promise((resolve) => setTimeout(resolve, 90));
    const display = connect('role=display');
    const afterLeave = await display.next('sketch');
    assert.equal(Object.values(afterLeave.owners).flat().some((person) => person.id === wc.participantId), false);
    assert.equal(Object.keys(afterLeave.owners).length, 3);
  } finally { close(); await new Promise((resolve) => server.close(resolve)); }
}
