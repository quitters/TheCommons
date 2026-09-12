// A numeric control is explicitly declared, never inferred from its name or
// numeric-looking choice labels. Inherited template values remain strings.
export function defaultValue(variable) {
  return variable.type === 'number' ? variable.default : variable.values?.[0]?.text ?? null;
}

export function onStep(variable, value) {
  const steps = (value - variable.min) / variable.step;
  return Number.isFinite(steps) && Math.abs(steps - Math.round(steps)) < 1e-7;
}

export function numericValue(variable, value) {
  if (!Number.isFinite(value) || value < variable.min || value > variable.max) return null;
  const snapped = variable.min + Math.round((value - variable.min) / variable.step) * variable.step;
  return Math.min(variable.max, Math.max(variable.min, Number(snapped.toPrecision(12))));
}
