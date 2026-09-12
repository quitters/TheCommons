import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// A browser request only starts a job. Work continues independently, and the
// prompt + completed result survive reloads. Never write into templates/.
export function createGenerationJobs({ directory, generate, publish, getSketch }) {
  fs.mkdirSync(directory, { recursive: true });
  const jobs = new Map();
  let active = null;
  function save(job) {
    const filename = path.join(directory, `${job.id}.json`);
    fs.writeFileSync(`${filename}.tmp`, JSON.stringify(job, null, 2));
    fs.renameSync(`${filename}.tmp`, filename);
  }
  for (const filename of fs.readdirSync(directory).filter((file) => file.endsWith('.json'))) {
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
    latestSketch() {
      return [...jobs.values()].filter((job) => job.applied && job.sketch)
        .sort((a, b) => b.finishedAt - a.finishedAt)[0]?.sketch ?? null;
    },
    start(prompt, { apply = true, id = randomUUID() } = {}) {
      if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('invalid remix request ID');
      const existing = jobs.get(id);
      if (existing) {
        if (existing.prompt !== prompt) throw new Error('request ID belongs to another prompt');
        return { job: snapshot(existing), completion: active?.job.id === id ? active.completion : Promise.resolve(existing.sketch ?? null) };
      }
      if (active) {
        const error = new Error('The room already has a remix in progress.');
        error.jobId = active.job.id;
        throw error;
      }
      const job = { id, prompt, status: 'generating', createdAt: Date.now() };
      const before = getSketch();
      save(job); // do not start a potentially paid call if the prompt cannot be saved
      jobs.set(job.id, job);
      const entry = { job, completion: null };
      active = entry;
      entry.completion = Promise.resolve().then(async () => {
        try {
          const sketch = await generate(prompt);
          job.sketch = sketch;
          job.status = sketch.fallback ? 'fallback' : 'completed';
          job.finishedAt = Date.now();
          job.applied = apply && getSketch() === before;
          save(job); // save the finished piece before broadcasting it
          if (job.applied) publish(sketch);
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
