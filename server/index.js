import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSketch, pickFallback } from './generate.js';
import { createRelay } from './relay.js';
import { startFacilitator } from './facilitator.js';
import { generationConfig } from './generation-config.js';
import { createGenerationJobs } from './generation-jobs.js';
import { adminAccess } from './admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());
const admin = adminAccess(process.env.ADMIN_PASSWORD);
app.post('/api/admin/login', admin.login);
app.post('/api/admin/logout', admin.logout);
app.get('/api/admin/session', admin.status);
app.use('/admin', express.static(path.join(__dirname, '../client/admin')));
app.use('/display', express.static(path.join(__dirname, '../client/display')));
app.use('/station', express.static(path.join(__dirname, '../client/station')));
app.use('/shared', express.static(path.join(__dirname, '../client/shared')));
app.get('/', (_req, res) => res.redirect('/display/'));

const server = http.createServer(app);
const relay = createRelay(server);
const jobs = createGenerationJobs({
  directory: process.env.GENERATION_DATA_DIR || path.join(__dirname, '../.commons-data/generations'),
  generate: generateSketch, publish: relay.setSketch, getSketch: relay.getSketch, getValues: relay.getValues,
});
const bootSketch = jobs.latestSketch() || pickFallback();
relay.setSketch(bootSketch, jobs.latestValues());

app.get('/api/admin/canvas', admin.require, (_req, res) => res.json({
  name: relay.getSketch()?.name, sketchId: relay.getSketch()?.id, canUndo: jobs.canUndo(),
}));
app.post('/api/admin/undo', admin.require, (_req, res) => {
  try { res.json({ name: jobs.undo().name }); }
  catch (error) { res.status(409).json({ error: error.message }); }
});

function readPrompt(req, res) {
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  if (!prompt || prompt.length > 2000) {
    res.status(400).json({ error: 'prompt must be text between 1 and 2000 characters' });
    return null;
  }
  return prompt;
}
function startJob(prompt, res, id, mode = 'create', baseSketchId) {
  if (!['create', 'remix'].includes(mode)) {
    res.status(400).json({ error: 'mode must be create or remix' });
    return null;
  }
  if (id !== undefined && (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id))) {
    res.status(400).json({ error: 'invalid remix request ID' });
    return null;
  }
  try { return jobs.start(prompt, { id, mode, baseSketchId }); }
  catch (error) {
    res.status(error.status || (error.jobId ? 409 : 503)).json({ error: error.status || error.jobId ? error.message : 'Could not save the remix request.', jobId: error.jobId });
    return null;
  }
}
app.post('/api/generations', admin.require, (req, res) => {
  const prompt = readPrompt(req, res);
  if (!prompt) return;
  const started = startJob(prompt, res, req.body.requestId, req.body.mode, req.body.baseSketchId);
  if (started) res.status(202).json(started.job);
});
app.get('/api/generations/active', admin.require, (_req, res) => res.json(jobs.active()));
app.get('/api/generations/:id', admin.require, (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'remix not found' });
  res.json(job);
});
// Retain the original endpoint for integrations. The creator desk uses the async
// job API, so browser/proxy HTTP timeouts cannot discard a long model call.
app.post('/api/generate', admin.require, async (req, res) => {
  const prompt = readPrompt(req, res);
  if (!prompt) return;
  const started = startJob(prompt, res);
  if (!started) return;
  const sketch = await started.completion;
  if (!sketch) return res.status(503).json({ error: 'remix failed', jobId: started.job.id });
  res.json(sketch);
});

app.get('/api/telemetry', (_req, res) => res.json(relay.getTelemetry()));

if (process.env.FACILITATOR_ENABLED !== 'false') startFacilitator(relay, {
  generate: async (prompt) => {
    const started = jobs.start(prompt, { apply: false });
    const sketch = await started.completion;
    if (!sketch) throw new Error('facilitator remix failed');
    return sketch;
  },
});

const PORT = process.env.PORT || 4173;
// Explicit 0.0.0.0, not the platform default: this needs to be reachable from
// other devices on the venue's network (phones at other tables), and on some
// Windows configurations an unqualified .listen(port) binds IPv6-only, which
// "localhost" doesn't always resolve to first -- the exact trap documented in
// a sibling project's own README. Binding explicitly avoids depending on it.
server.listen(PORT, '0.0.0.0', () => {
  console.log(`The Commons running:`);
  console.log(`  Display (put this on the shared screen/projector): http://127.0.0.1:${PORT}/display/`);
  console.log(`  Station (one per table, from any device on this network): http://<this-machine's-LAN-IP>:${PORT}/station/?table=1`);
  try {
    const config = generationConfig();
    console.log(`  Generation: ${config.key ? `live (${config.provider}, ${config.model})` : 'built-in + inherited template library only'}`);
  } catch { console.log('  Generation: fallback (check generation configuration)'); }
  console.log(`  Facilitator: ${process.env.FACILITATOR_ENABLED === 'false' ? 'off' : 'on'}`);
  console.log(`  Booted on: ${bootSketch.name}${bootSketch.p5Code ? ' (inherited p5 template)' : ' (native)'}`);
});
