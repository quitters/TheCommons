import fs from 'node:fs';

// The optional JSON file is read only on the server. No key is copied into
// this repository or exposed through API responses or startup logging.
export function generationConfig(env = process.env) {
  let provider = env.GENERATION_PROVIDER || 'auto';
  if (provider === 'fallback') return { provider: 'fallback', key: '' };
  if (provider === 'auto') provider = env.GEMINI_API_KEY || env.GEMINI_CONFIG_PATH ? 'gemini' : 'openai';
  if (!['gemini', 'openai'].includes(provider)) throw new Error('unknown GENERATION_PROVIDER');
  if (provider === 'openai') return { provider, key: env.OPENAI_API_KEY || '', model: env.MODEL || 'gpt-5.6-sol' };
  let key = env.GEMINI_API_KEY || '';
  if (!key && env.GEMINI_CONFIG_PATH) {
    try {
      const config = JSON.parse(fs.readFileSync(env.GEMINI_CONFIG_PATH, 'utf8'));
      if (typeof config.api_key === 'string') key = config.api_key.trim();
    } catch {
      throw new Error('could not read Gemini key configuration');
    }
  }
  const model = env.GEMINI_MODEL || 'gemini-3.1-pro-preview';
  if (!/^gemini-[a-z0-9.-]+$/.test(model)) throw new Error('invalid GEMINI_MODEL');
  const timeoutMs = Number(env.GEMINI_TIMEOUT_MS || 600_000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 1_800_000) throw new Error('GEMINI_TIMEOUT_MS must be 1000–1800000');
  return { provider, key, model, timeoutMs };
}
