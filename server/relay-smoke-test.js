// Exercises real WebSocket clients against the server booted by smoke-test.js.
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { defaultValue } from '../client/shared/parameters.js';

export function relayClients(baseUrl) {
  const clients = [];
  function connect(query) {
    const ws = new WebSocket(`${baseUrl.replace('http', 'ws')}/ws?${query}`);
    const messages = [];
    let wake;
    let failure;
    ws.on('message', (raw) => { messages.push(JSON.parse(raw)); wake?.(); });
    ws.on('error', (error) => { failure = error; wake?.(); });
    const client = {
      ws,
      async next(type) {
        const deadline = Date.now() + 3000;
        while (true) {
          if (failure) throw failure;
          const index = messages.findIndex((message) => message.type === type);
          if (index !== -1) return messages.splice(index, 1)[0];
          const remaining = deadline - Date.now();
          assert.ok(remaining > 0, `timed out waiting for ${type} (${query})`);
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, remaining);
            wake = () => { clearTimeout(timer); resolve(); };
          });
          wake = null;
        }
      },
      send(varName, value) { ws.send(JSON.stringify({ type: 'var', varName, value })); },
    };
    clients.push(client);
    return client;
  }
  return { clients, connect, close: () => { for (const { ws } of clients) ws.terminate(); } };
}

export async function checkRelay(baseUrl, headers = {}) {
  const { clients, connect, close } = relayClients(baseUrl);
  try {
    const a = connect('role=station&table=smoke-a');
    const b = connect('role=station&table=smoke-b');
    const display = connect('role=display');
    const [welcome, other, initial] = await Promise.all([a.next('welcome'), b.next('welcome'), display.next('sketch')]);
    assert.deepEqual(welcome.values, other.values);
    assert.deepEqual(welcome.values, initial.values);
    const variable = welcome.sketch.variables.find((v) => other.owners[v.name]?.some((person) => person.id === welcome.participantId) && new Set(v.values?.map((x) => x.text)).size > 1);
    assert.ok(variable, 'boot sketch needs a control with two choices');
    const first = variable.values[0].text;
    const second = variable.values.find((v) => v.text !== first).text;
    a.send(variable.name, second);
    for (const client of [a, b, display]) {
      const update = await client.next('var');
      assert.equal(update.value, second);
      assert.equal(update.table, 'smoke-a');
    }
    b.send(variable.name, first);
    const held = await b.next('not_owner');
    assert.equal(held.value, second, 'rejected turn must restore the accepted value');
    assert.equal(held.owners[variable.name][0].id, welcome.participantId);


    const lateStation = connect('role=station&table=smoke-late');
    const lateDisplay = connect('role=display');
    assert.equal((await lateStation.next('welcome')).values[variable.name], second);
    assert.equal((await lateDisplay.next('sketch')).values[variable.name], second);

    // Invalid/stale controls must not alter ownership or engagement telemetry.
    a.send('__missing_control__', 'anything');
    a.send(variable.name, '__invalid_choice__');
    a.send(variable.name, first);
    for (const client of clients) assert.equal((await client.next('var')).value, first);
    const telemetry = await (await fetch(`${baseUrl}/api/telemetry`)).json();
    assert.equal(telemetry.changesByTable['smoke-a'], 2);
    assert.equal(telemetry.changesByTable['smoke-b'], undefined);

    const response = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ prompt: 'a fresh shared canvas' }),
    });
    assert.equal(response.status, 200);
    const next = await response.json();
    const defaults = Object.fromEntries(next.variables.map((v) => [v.name, defaultValue(v)]));
    let nextOwners;
    for (const client of clients) {
      const update = await client.next('sketch');
      nextOwners = update.owners;
      assert.deepEqual(update.sketch, next, 'all open clients must receive a remix');
      assert.deepEqual(update.values, defaults, 'a remix resets stale values');
    }
    const nextVariable = next.variables.find((v) => nextOwners[v.name]?.some((person) => person.id === welcome.participantId));
    assert.ok(nextVariable, 'the first participant retains an assigned control after remix');
    a.send(nextVariable.name, defaultValue(nextVariable));
    for (const client of clients) assert.equal((await client.next('var')).table, 'smoke-a');
  } finally {
    close();
  }
}
