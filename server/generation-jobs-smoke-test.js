import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGenerationJobs } from './generation-jobs.js';
import { generationPrompt } from './generate.js';

export async function checkGenerationJobs() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'commons-jobs-test-'));
  let finish, calls = 0, current = {}, currentValues = {}, generationOptions;
  const options = {
    directory, getSketch: () => current, getValues: () => ({ ...currentValues }),
    publish: (sketch, values = {}) => { current = sketch; currentValues = values; },
    generate: (_prompt, options) => { generationOptions = options; calls++; return new Promise((resolve) => { finish = resolve; }); },
  };
  try {
    const jobs = createGenerationJobs(options);
    const started = jobs.start('a slow-to-generate piece');
    await Promise.resolve();
    assert.equal(calls, 1);
    assert.equal(jobs.get(started.job.id).status, 'generating');
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, `${started.job.id}.json`))).prompt, 'a slow-to-generate piece');
    const reconnected = jobs.start(started.job.prompt, { id: started.job.id });
    assert.equal(reconnected.completion, started.completion);
    assert.equal(calls, 1);
    assert.throws(() => jobs.start('a different remix'), (error) => error.jobId === started.job.id);
    const sketch = { name: 'Finished piece', fallback: false, code: 'ctx.fillRect(0,0,1,1);', variables: [] };
    finish(sketch);
    await started.completion;
    assert.equal(current, sketch);
    assert.equal(jobs.get(started.job.id).status, 'completed');
    const restored = createGenerationJobs(options);
    assert.deepEqual(restored.latestSketch(), sketch);
    assert.deepEqual(await restored.start(started.job.prompt, { id: started.job.id }).completion, sketch);
    assert.equal(calls, 1, 'a completed request must not generate again after restart');
    const snapshot = jobs.get(started.job.id);
    snapshot.prompt = 'mutated';
    assert.equal(jobs.get(started.job.id).prompt, started.job.prompt);
    // Simulate a process dying with a saved in-flight request, then boot again.
    const interrupted = { id: '19d8b8a9-65d3-465e-9f54-4e41c593f264', prompt: 'keep this idea', status: 'generating', createdAt: Date.now() };
    fs.writeFileSync(path.join(directory, `${interrupted.id}.json`), JSON.stringify(interrupted));
    const afterRestart = createGenerationJobs(options);
    assert.equal(afterRestart.get(interrupted.id).status, 'interrupted');
    assert.equal(afterRestart.get(interrupted.id).prompt, 'keep this idea');
    assert.equal(calls, 1, 'restart recovery must not silently incur another model call');
    const stale = jobs.start('older idea');
    await Promise.resolve();
    const newer = {};
    current = newer;
    finish(sketch); await stale.completion;
    assert.equal(current, newer);
    assert.equal(jobs.get(stale.job.id).applied, false);

    current = { ...sketch, id: 'source-piece', code: '/* source drawing */' };
    currentValues = { speed: 0, palette: 'coral' };
    const original = structuredClone(current);
    const remix = jobs.start('make the lines softer', { mode: 'remix', baseSketchId: current.id });
    await Promise.resolve();
    assert.deepEqual(generationOptions.source, { sketch: original, values: currentValues });
    assert.equal(generationOptions.mode, 'remix');
    assert.throws(() => jobs.undo(), /finish/);
    assert.throws(() => jobs.start(remix.job.prompt, { id: remix.job.id, mode: 'create' }), /mode/);
    const text = generationPrompt(remix.job.prompt, generationOptions);
    assert.ok(text.includes('source drawing') && text.includes('"speed":0') && text.includes('make the lines softer'));
    const result = { ...sketch, id: 'remixed-piece' };
    finish(result); await remix.completion;
    assert.equal(jobs.canUndo(), true);
    const recovered = createGenerationJobs(options);
    assert.equal(recovered.latestSketch().id, 'remixed-piece');
    recovered.undo();
    assert.deepEqual(current, original);
    assert.deepEqual(currentValues, { speed: 0, palette: 'coral' });
    assert.equal(recovered.canUndo(), false);
    assert.equal(createGenerationJobs(options).latestSketch().id, 'source-piece', 'undo survives restart');
    assert.throws(() => recovered.start('stale request', { mode: 'remix', baseSketchId: 'old-piece' }), /changed/);
    const fresh = recovered.start('an entirely new scene', { mode: 'create' });
    await Promise.resolve();
    assert.equal(generationOptions.source, undefined, 'new pieces receive no source context');
    assert.equal(generationPrompt('new idea', generationOptions), 'new idea');
    finish(result); await fresh.completion;
    assert.deepEqual(currentValues, {});
    const inherited = generationPrompt('soften it', { mode: 'remix', source: { sketch: { p5Code: 'p.draw = function(){};', variables: [] }, values: {} } });
    assert.match(inherited, /never return p5Code or combine runtimes/);
  } finally {
    for (const filename of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, filename));
    fs.rmdirSync(directory);
  }
}
