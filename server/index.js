import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSketch, pickFallback } from './generate.js';
import { createRelay } from './relay.js';
import { startFacilitator } from './facilitator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());
app.use('/display', express.static(path.join(__dirname, '../client/display')));
app.use('/station', express.static(path.join(__dirname, '../client/station')));
app.get('/', (_req, res) => res.redirect('/display/'));

const server = http.createServer(app);
const relay = createRelay(server);
const bootSketch = pickFallback(); // a random pick across both the native and inherited p5 libraries
relay.setSketch(bootSketch);

app.post('/api/generate', async (req, res) => {
  const prompt = (req.body?.prompt || '').trim();
  if (!prompt) return res.status(400).json({ error: "need 'prompt'" });
  const sketch = await generateSketch(prompt);
  relay.setSketch(sketch);
  res.json(sketch);
});

app.get('/api/telemetry', (_req, res) => res.json(relay.getTelemetry()));

startFacilitator(relay);

const PORT = process.env.PORT || 4173;
server.listen(PORT, () => {
  console.log(`The Commons running:`);
  console.log(`  Display (put this on the shared screen/projector): http://localhost:${PORT}/display/`);
  console.log(`  Station (one per table):                           http://localhost:${PORT}/station/?table=1`);
  console.log(`  Generation: ${process.env.OPENAI_API_KEY ? 'live (OpenAI configured)' : 'built-in + inherited template library only (no OPENAI_API_KEY)'}`);
  console.log(`  Booted on: ${bootSketch.name}${bootSketch.p5Code ? ' (inherited p5 template)' : ' (native)'}`);
});
