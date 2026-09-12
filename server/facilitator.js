import { generateSketch } from './generate.js';

// The actual "agent" in this project: it perceives real aggregate behavior
// from a physical room (which tables are active, which have gone quiet, how
// long since the piece last meaningfully changed), decides when the room
// needs the piece to evolve, and acts by calling the same generation path a
// person's own prompt would use -- autonomously, with no operator.
const EVOLVE_AFTER_IDLE_MS = 90_000;
const CHECK_INTERVAL_MS = 10_000;

export function startFacilitator(relay) {
  const timer = setInterval(async () => {
    const telemetry = relay.getTelemetry();
    if (telemetry.msSinceLastActivity < EVOLVE_AFTER_IDLE_MS) return;

    const topTables = Object.entries(telemetry.changesByTable)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([table]) => table);

    const prompt = topTables.length
      ? `The room has been quiet for a while. Earlier, tables ${topTables.join(', ')} were the most active. Generate something that feels like a natural evolution of the mood so far, not a repeat of it.`
      : `Nobody has touched a knob in a while. Generate a fresh, inviting piece to re-engage the room.`;

    console.log('[facilitator] room went quiet -- evolving the piece:', prompt);
    const sketch = await generateSketch(prompt);
    relay.setSketch(sketch);
  }, CHECK_INTERVAL_MS);

  return () => clearInterval(timer);
}
