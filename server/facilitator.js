import { generateSketch } from './generate.js';

// The actual "agent" in this project: it perceives real aggregate behavior
// from a physical room (which tables are active, which have gone quiet, how
// long since the piece last meaningfully changed), decides when the room
// needs the piece to evolve, and acts by calling the same generation path a
// person's own prompt would use -- autonomously, with no operator.
const EVOLVE_AFTER_IDLE_MS = 90_000;
const CHECK_INTERVAL_MS = 10_000;

export function startFacilitator(relay, { generate = generateSketch, now = Date.now,
  schedule = setInterval, cancel = clearInterval } = {}) {
  let pending = false;
  let stopped = false;
  let lastEvolution = now();
  let observedSketch = relay.getSketch();
  const timer = schedule(async () => {
    if (stopped || pending) return;
    if (relay.getSketch() !== observedSketch) {
      observedSketch = relay.getSketch();
      lastEvolution = now(); // a person's remix deserves time on the wall too
    }
    const telemetry = relay.getTelemetry();
    if (telemetry.msSinceLastActivity < EVOLVE_AFTER_IDLE_MS || now() - lastEvolution < EVOLVE_AFTER_IDLE_MS) return;

    const topTables = Object.entries(telemetry.changesByTable)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([table]) => table);

    const prompt = topTables.length
      ? `The room has been quiet for a while. Earlier, tables ${topTables.join(', ')} were the most active. Generate something that feels like a natural evolution of the mood so far, not a repeat of it.`
      : `Nobody has touched a knob in a while. Generate a fresh, inviting piece to re-engage the room.`;

    console.log('[facilitator] room went quiet -- evolving the piece:', prompt);
    pending = true;
    const before = relay.getSketch();
    try {
      const sketch = await generate(prompt);
      // A later manual remix wins over an older facilitator request.
      if (!stopped && relay.getSketch() === before) {
        relay.setSketch(sketch);
        observedSketch = sketch;
      }
    } catch { console.warn('[facilitator] generation failed; keeping the current piece'); }
    finally { pending = false; lastEvolution = now(); }
  }, CHECK_INTERVAL_MS);

  return () => { stopped = true; cancel(timer); };
}
