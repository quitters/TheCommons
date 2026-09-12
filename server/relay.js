import { WebSocketServer } from 'ws';

// Soft per-variable ownership, not a blended average: when table X turns a
// knob, table X "holds" that variable for a few seconds so their turn visibly
// causes something before anyone else can override it. A blended average is
// more "collective" in spirit but far harder for anyone in a room to feel
// they actually caused something -- legibility matters more than fairness
// for a live demo.
const OWNERSHIP_MS = 4000;

export function createRelay(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const displays = new Set();
  const stations = new Set();
  const values = new Map(); // authoritative values, also sent to late joiners
  const owners = new Map(); // varName -> { table, until }
  const telemetry = { lastActivity: Date.now(), changesByTable: new Map(), tableSeen: new Map() };

  let currentSketch = null;

  function broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const ws of [...displays, ...stations]) if (ws.readyState === ws.OPEN) ws.send(data);
  }

  function setSketch(sketch) {
    currentSketch = sketch;
    owners.clear();
    values.clear();
    for (const v of sketch.variables || []) values.set(v.name, v.values?.[0]?.text ?? null);
    broadcast({ type: 'sketch', sketch, values: Object.fromEntries(values) });
  }

  function applyVarUpdate(ws, table, varName, value) {
    const variable = currentSketch?.variables.find((v) => v.name === varName);
    if (!variable?.values.some((v) => v.text === value)) return;
    const owner = owners.get(varName);
    const now = Date.now();
    if (owner && owner.table !== table && now < owner.until) {
      ws.send(JSON.stringify({ type: 'held', varName, value: values.get(varName), table: owner.table, until: owner.until }));
      return;
    }
    owners.set(varName, { table, until: now + OWNERSHIP_MS });
    values.set(varName, value);
    telemetry.lastActivity = now;
    telemetry.tableSeen.set(table, now);
    telemetry.changesByTable.set(table, (telemetry.changesByTable.get(table) || 0) + 1);
    broadcast({ type: 'var', varName, value, table });
  }

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://internal');
    const role = url.searchParams.get('role');

    if (role === 'display') {
      displays.add(ws);
      if (currentSketch) ws.send(JSON.stringify({ type: 'sketch', sketch: currentSketch, values: Object.fromEntries(values) }));
      ws.on('close', () => displays.delete(ws));
      return;
    }

    // role === 'station' (or unspecified -- default to station)
    const table = url.searchParams.get('table') || `table-${Math.random().toString(36).slice(2, 6)}`;
    stations.add(ws);
    ws.on('close', () => stations.delete(ws));
    ws.send(JSON.stringify({ type: 'welcome', table, sketch: currentSketch, values: Object.fromEntries(values) }));

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === 'var' && typeof msg.varName === 'string') {
        applyVarUpdate(ws, table, msg.varName, msg.value);
      }
    });
  });

  return {
    setSketch,
    getSketch: () => currentSketch,
    getTelemetry() {
      const now = Date.now();
      return {
        activeTables: [...telemetry.tableSeen.entries()]
          .filter(([, seenAt]) => now - seenAt < 30_000)
          .map(([table]) => table),
        msSinceLastActivity: now - telemetry.lastActivity,
        changesByTable: Object.fromEntries(telemetry.changesByTable),
      };
    },
  };
}
