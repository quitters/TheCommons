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
  const owners = new Map(); // varName -> { table, until }
  const telemetry = { lastActivity: Date.now(), changesByTable: new Map(), tableSeen: new Map() };

  let currentSketch = null;

  function broadcastToDisplays(msg) {
    const data = JSON.stringify(msg);
    for (const ws of displays) if (ws.readyState === ws.OPEN) ws.send(data);
  }

  function setSketch(sketch) {
    currentSketch = sketch;
    owners.clear();
    broadcastToDisplays({ type: 'sketch', sketch });
  }

  function applyVarUpdate(table, varName, value) {
    const owner = owners.get(varName);
    const now = Date.now();
    if (owner && owner.table !== table && now < owner.until) return; // someone else just touched this
    owners.set(varName, { table, until: now + OWNERSHIP_MS });
    telemetry.lastActivity = now;
    telemetry.tableSeen.set(table, now);
    telemetry.changesByTable.set(table, (telemetry.changesByTable.get(table) || 0) + 1);
    broadcastToDisplays({ type: 'var', varName, value, table });
  }

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://internal');
    const role = url.searchParams.get('role');

    if (role === 'display') {
      displays.add(ws);
      if (currentSketch) ws.send(JSON.stringify({ type: 'sketch', sketch: currentSketch }));
      ws.on('close', () => displays.delete(ws));
      return;
    }

    // role === 'station' (or unspecified -- default to station)
    const table = url.searchParams.get('table') || `table-${Math.random().toString(36).slice(2, 6)}`;
    ws.send(JSON.stringify({ type: 'welcome', table, sketch: currentSketch }));

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === 'var' && typeof msg.varName === 'string') {
        applyVarUpdate(table, msg.varName, msg.value);
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
