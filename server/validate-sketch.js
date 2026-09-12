// Only freshly generated Canvas2D sketches pass through this gate. The
// inherited p5 library keeps its own contract and its verbatim source files.
// This checks structure and syntax, not runtime safety or artistic quality.
import { onStep } from '../client/shared/parameters.js';

export function validateNativeSketch(sketch) {
  const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
  function require(condition, message) {
    if (!condition) throw new Error(`invalid native sketch: ${message}`);
  }
  require(sketch && typeof sketch === 'object' && !Array.isArray(sketch), 'expected an object');
  require(!Object.hasOwn(sketch, 'p5Code'), 'p5Code belongs only to the inherited library');
  require(nonempty(sketch.name), 'missing name');
  require(nonempty(sketch.promptTemplate), 'missing promptTemplate');
  require(nonempty(sketch.code), 'missing drawing code');
  require(Array.isArray(sketch.variables) && sketch.variables.length >= 2 && sketch.variables.length <= 6,
    'expected 2–6 variables');
  const names = new Set();
  const variables = sketch.variables.map((v) => {
    require(v && typeof v === 'object' && typeof v.name === 'string'
      && /^[a-z][a-z0-9_]*$/.test(v.name)
      && !['constructor', 'prototype'].includes(v.name), 'invalid variable name');
    require(!names.has(v.name), `duplicate variable ${v.name}`);
    names.add(v.name);
    const label = nonempty(v.label) ? v.label : v.name.replaceAll('_', ' ');
    require(v.type === undefined || v.type === 'select' || v.type === 'number', 'unknown control type');
    if (v.type === 'number') {
      require(!Object.hasOwn(v, 'values'), `${v.name} cannot mix a numeric range and choices`);
      require([v.min, v.max, v.step, v.default].every(Number.isFinite), `${v.name} needs finite min/max/step/default`);
      require(v.min < v.max && v.step > 0 && v.step <= v.max - v.min, `${v.name} has an invalid range`);
      require(v.default >= v.min && v.default <= v.max, `${v.name} default is outside its range`);
      require(onStep(v, v.max) && onStep(v, v.default), `${v.name} max and default must align with step from min`);
      return { name: v.name, label, type: 'number', min: v.min, max: v.max, step: v.step, default: v.default };
    }
    require(Array.isArray(v.values) && v.values.length >= 3 && v.values.length <= 6,
      `${v.name} needs 3–6 choices`);
    const texts = new Set();
    const values = v.values.map((value) => {
      require(value && typeof value === 'object' && nonempty(value.text), `${v.name} has a malformed choice`);
      require(!texts.has(value.text), `${v.name} has duplicate choices`);
      texts.add(value.text);
      const weight = value.weight ?? 1;
      require([1, 2, 3].includes(weight), `${v.name} has an invalid weight`);
      return { text: value.text, weight };
    });
    return { name: v.name, label, values };
  });
  const placeholders = new Set([...sketch.promptTemplate.matchAll(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g)].map((match) => match[1]));
  require(placeholders.size === names.size && [...names].every((name) => placeholders.has(name)),
    'prompt placeholders must match the controls');
  require(!sketch.promptTemplate.replace(/\{\{\s*[a-z][a-z0-9_]*\s*\}\}/g, '').includes('{{'),
    'malformed prompt placeholder');
  // Compile, but NEVER execute model-authored drawing code on the server.
  new Function('ctx', 'frame', 'getVar', 'audio', sketch.code);
  return { name: sketch.name.trim(), promptTemplate: sketch.promptTemplate, variables, code: sketch.code };
}
