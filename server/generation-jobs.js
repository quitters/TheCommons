import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// A browser request only starts a job. Work continues independently, and the
// prompt + completed result survive reloads. Never write into templates/.
export function createGenerationJobs({ directory, generate, publish, getSketch, getValues = () => ({}) }) {
  fs.mkdirSync(directory, { recursive: true });
  const jobs = new Map();
  let active = null;
  const statePath = path.join(directory, 'room-state.json');
  let roomState = null;
  try { roomState = JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch {}
  function saveRoom(next) {
    fs.writeFileSync(`${statePath}.tmp`, JSON.stringify(next, null, 2));
    fs.renameSync(`${statePath}.tmp`, statePath);
    roomState = next;
  }
  function save(job) {
    const filename = path.join(directory, `${job.id}.json`);
    fs.writeFileSync(`${filename}.tmp`, JSON.stringify(job, null, 2));
    fs.renameSync(`${filename}.tmp`, filename);
  }
  for (const filename of fs.readdirSync(directory).filter((file) => file.endsWith('.json') && file !== 'room-state.json')) {
    try {
      const job = JSON.parse(fs.readFileSync(path.join(directory, filename), 'utf8'));
      if (!/^[a-f0-9-]{36}$/.test(job.id) || typeof job.prompt !== 'string') continue;
      if (job.status === 'generating') {
        job.status = 'interrupted';
        job.error = 'The server restarted during generation. Your prompt was saved; retry when ready.';
        job.finishedAt = Date.now();
        save(job);
      }
      jobs.set(job.id, job);
    } catch { console.warn('[generation jobs] could not restore a saved job'); }
  }
  function snapshot(job) { return job ? structuredClone(job) : null; }
  return {
    get: (id) => snapshot(jobs.get(id)),
    active: () => snapshot(active?.job),
    canUndo: () => Boolean(roomState?.undo) && !active,
    latestValues: () => snapshot(roomState?.values) || {},
    undo() {
      if (active) throw new Error('Wait for the current generation to finish before undoing.');
      if (!roomState?.undo) throw new Error('There is no previous piece to restore.');
      const previous = roomState.undo;
      saveRoom({ ...previous, undo: null });
      publish(previous.sketch, previous.values);
      return previous.sketch;
    },
    latestSketch() {
      if (roomState?.sketch) return snapshot(roomState.sketch);
      return [...jobs.values()].filter((job) => job.applied && job.sketch)
        .sort((a, b) => b.finishedAt - a.finishedAt)[0]?.sketch ?? null;
    },
    start(prompt, { apply = true, id = randomUUID(), mode = 'create', baseSketchId } = {}) {
      if (!['create', 'remix'].includes(mode)) throw new Error('Unknown generation mode');
      if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('invalid remix request ID');
      const existing = jobs.get(id);
      if (existing) {
        if (existing.prompt !== prompt || (existing.mode || 'create') !== mode) throw new Error('request ID belongs to another prompt or mode');
        return { job: snapshot(existing), completion: active?.job.id === id ? active.completion : Promise.resolve(existing.sketch ?? null) };
      }
      if (active) {
        const error = new Error('The room already has a remix in progress.');
        error.jobId = active.job.id;
        throw error;
      }
      const before = getSketch();
      if (mode === 'remix' && (!before || (baseSketchId && baseSketchId !== before.id))) {
        const error = new Error('The piece changed. Review the current canvas before remixing.');
        error.status = 409;
        throw error;
      }
      const previous = { sketch: snapshot(before), values: getValues() };
      const job = { id, prompt, mode, ...(mode === 'remix' ? { source: previous } : {}), status: 'generating', createdAt: Date.now() };
      save(job); // do not start a potentially paid call if the prompt cannot be saved
      jobs.set(job.id, job);
      const entry = { job, completion: null };
      active = entry;
      entry.completion = Promise.resolve().then(async () => {
        try {
          const sketch = await generate(prompt, { mode, ...(mode === 'remix' ? { source: snapshot(previous) } : {}) });
          job.sketch = sketch;
          job.status = sketch.fallback ? 'fallback' : 'completed';
          job.finishedAt = Date.now();
          job.applied = apply && getSketch() === before;
          save(job); // save the finished piece before broadcasting it
          if (job.applied) {
            const values = mode === 'remix' && !sketch.fallback ? previous.values : {};
            saveRoom({ sketch, values, undo: previous.sketch ? previous : null });
            publish(sketch, values);
          }
          return sketch;
        } catch {
          job.status = 'failed';
          job.error = 'Could not finish and save the remix. Your prompt is retained; try again.';
          job.finishedAt = Date.now();
          job.applied = false;
          try { save(job); } catch { console.warn('[generation jobs] could not save final status'); }
          return null;
        } finally { if (active === entry) active = null; }
      });
      return { job: snapshot(job), completion: entry.completion };
    },
  };
}
