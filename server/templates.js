import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The curated default template library. These are INHERITED content, not
// written from scratch -- pulled verbatim from synthograsizer-suite's own
// p5.js template set (itself, per each file's own `tags` field, adapted from
// earlier open generative-art sources). That's explicitly allowed under the
// event rules ("existing templates... may be used as building blocks") and
// is called out plainly in README.md. Everything that RUNS these templates
// (the relay, the facilitator, the p5 adapter below, the station UI) is new.
//
// Two templates are present in templates/ but excluded from the auto-picked
// pool: they use a non-default p5 renderer mode (SVG) this project's display
// runtime doesn't yet special-case -- see README's "documented next step".
const EXCLUDED = new Set(['svg-flow-particles']);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(__dirname, '../templates');

function titleCase(filename) {
  return filename
    .replace(/\.json$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeVariables(variables) {
  return (variables || []).map((v) => ({
    name: v.name,
    label: v.label || v.feature_name || titleCase(v.name),
    values: v.values || [],
  }));
}

let cache = null;

export function loadTemplateLibrary() {
  if (cache) return cache;
  cache = fs.readdirSync(TEMPLATES_DIR)
    .filter((f) => f.endsWith('.json'))
    .filter((f) => !EXCLUDED.has(f.replace(/\.json$/, '')))
    .map((f) => {
      const raw = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, f), 'utf-8'));
      return {
        id: f.replace(/\.json$/, ''),
        name: titleCase(f),
        promptTemplate: raw.promptTemplate || '',
        variables: normalizeVariables(raw.variables),
        p5Code: raw.p5Code,
        source: 'inherited from synthograsizer-suite’s template library',
      };
    })
    .filter((t) => typeof t.p5Code === 'string' && t.p5Code.length > 0);
  return cache;
}

export function randomTemplate() {
  const lib = loadTemplateLibrary();
  return lib[Math.floor(Math.random() * lib.length)];
}
