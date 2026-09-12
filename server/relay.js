import { WebSocketServer } from 'ws';
import { randomBytes, randomUUID } from 'node:crypto';
import { defaultValue, numericValue } from '../client/shared/parameters.js';

// Creator-directed ownership: distribute distinct controls among individuals.
// Joining/leaving rebalances the fewest controls needed; values never average.
export function createRelay(httpServer, { disconnectGraceMs = 30_000 } = {}) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const displays = new Set();
  const stations = new Set();
  const participants = new Map(); // private session token -> participant
  const assigned = new Map(); // variable name -> Set of participants
  const holds = new Map(); // shared controls retain a legible four-second turn
  const values = new Map();
  const telemetry = { lastActivity: Date.now(), changesByTable: new Map(), tableSeen: new Map() };
  let currentSketch = null;

  function ownership() {
    return Object.fromEntries([...assigned].map(([name, people]) => [name, [...people].map((person) => ({ id: person.id, table: person.table }))]));
  }
  function broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const ws of [...displays, ...stations]) if (ws.readyState === ws.OPEN) ws.send(data);
  }
  function distribute() {
    const people = [...participants.values()];
    const names = new Set((currentSketch?.variables || []).map((v) => v.name));
    for (const [name, group] of assigned) {
      if (!names.has(name)) { assigned.delete(name); holds.delete(name); continue; }
      for (const person of group) if (!people.includes(person)) group.delete(person);
    }
    if (!people.length || !names.size) { assigned.clear(); holds.clear(); return; }
    for (const name of names) if (!assigned.has(name)) assigned.set(name, new Set());
    const count = (person) => [...assigned.values()].filter((group) => group.has(person)).length;
    const ranked = () => [...people].sort((a, b) => count(a) - count(b));
    if (names.size >= people.length) {
      // Enough controls: one owner per control, possibly several per person.
      for (const [name, group] of assigned) if (group.size > 1) assigned.set(name, new Set([group.values().next().value]));
      for (const group of assigned.values()) if (!group.size) group.add(ranked()[0]);
      while (true) {
        const ordered = ranked();
        const low = ordered[0], high = ordered.at(-1);
        if (count(high) - count(low) <= 1) break;
        const name = [...assigned].findLast(([, group]) => group.has(high))[0];
        assigned.set(name, new Set([low]));
      }
    } else {
      // More people than controls: everyone gets one, balanced into groups.
      for (const person of people) {
        const groups = [...assigned.values()].filter((group) => group.has(person));
        for (const group of groups.slice(1)) group.delete(person);
      }
      const groupRank = () => [...assigned.values()].sort((a, b) => a.size - b.size);
      for (const person of people) if (!count(person)) groupRank()[0].add(person);
      while (true) {
        const groups = groupRank(), low = groups[0], high = groups.at(-1);
        if (high.size - low.size <= 1) break;
        const person = [...high].at(-1);
        high.delete(person); low.add(person);
      }
    }
    for (const [name, hold] of holds) if (!assigned.get(name)?.has(hold.person)) holds.delete(name);
  }
  function setSketch(sketch, initialValues = {}) {
    currentSketch = sketch;
    values.clear();
    holds.clear();
    for (const v of sketch.variables || []) {
      const candidate = initialValues[v.name];
      const accepted = v.type === 'number' ? numericValue(v, candidate)
        : v.values?.some((choice) => choice.text === candidate) ? candidate : null;
      values.set(v.name, accepted ?? defaultValue(v));
    }
    distribute();
    broadcast({ type: 'sketch', sketch, values: Object.fromEntries(values), owners: ownership() });
  }
  function applyVarUpdate(ws, person, varName, value) {
    const variable = currentSketch?.variables.find((v) => v.name === varName);
    if (!variable) return;
    const group = assigned.get(varName);
    if (!group?.has(person)) {
      ws.send(JSON.stringify({ type: 'not_owner', varName, value: values.get(varName), owners: ownership() }));
      return;
    }
    if (variable.type === 'number') {
      value = numericValue(variable, value);
      if (value === null) return;
    } else if (!variable.values?.some((v) => v.text === value)) return;
    const hold = holds.get(varName);
    const now = Date.now();
    if (group.size > 1 && hold && hold.person !== person && hold.until > now) {
      ws.send(JSON.stringify({ type: 'held', varName, value: values.get(varName), table: hold.person.table, until: hold.until }));
      return;
    }
    values.set(varName, value);
    holds.set(varName, { person, until: now + 4000 });
    telemetry.lastActivity = now;
    telemetry.tableSeen.set(person.table, now);
    telemetry.changesByTable.set(person.table, (telemetry.changesByTable.get(person.table) || 0) + 1);
    broadcast({ type: 'var', varName, value, table: person.table, participantId: person.id });
  }
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://internal');
    if (url.searchParams.get('role') === 'display') {
      displays.add(ws);
      if (currentSketch) ws.send(JSON.stringify({ type: 'sketch', sketch: currentSketch, values: Object.fromEntries(values), owners: ownership() }));
      ws.on('close', () => displays.delete(ws));
      return;
    }
    let token = url.searchParams.get('session');
    let person = participants.get(token);
    if (!person) {
      token = randomBytes(32).toString('hex');
      person = { id: randomUUID(), table: (url.searchParams.get('table') || `table-${participants.size + 1}`).slice(0, 80), sockets: new Set(), timer: null };
      participants.set(token, person);
    }
    clearTimeout(person.timer);
    person.sockets.add(ws);
    stations.add(ws);
    distribute();
    ws.send(JSON.stringify({ type: 'welcome', table: person.table, participantId: person.id, session: token,
      sketch: currentSketch, values: Object.fromEntries(values), owners: ownership() }));
    broadcast({ type: 'ownership', owners: ownership() });
    ws.on('close', () => {
      stations.delete(ws);
      person.sockets.delete(ws);
      if (person.sockets.size) return;
      person.timer = setTimeout(() => {
        participants.delete(token);
        distribute();
        broadcast({ type: 'ownership', owners: ownership() });
      }, disconnectGraceMs);
      person.timer.unref();
    });
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg?.type === 'var' && typeof msg.varName === 'string') applyVarUpdate(ws, person, msg.varName, msg.value);
    });
  });
  httpServer.on('close', () => { for (const person of participants.values()) clearTimeout(person.timer); });
  return {
    setSketch, getSketch: () => currentSketch, getValues: () => Object.fromEntries(values),
    getTelemetry() {
      const now = Date.now();
      return { activeTables: [...telemetry.tableSeen].filter(([, at]) => now - at < 30_000).map(([table]) => table),
        msSinceLastActivity: now - telemetry.lastActivity, changesByTable: Object.fromEntries(telemetry.changesByTable) };
    },
  };
}
