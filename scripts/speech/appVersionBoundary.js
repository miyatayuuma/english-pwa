export function isAppVersionAtLeast(version, minimum) {
  const parse = value => {
    const match = String(value ?? '').match(/^v(\d+)\.(\d+)$/u);
    return match ? [Number(match[1]), Number(match[2])] : null;
  };
  const current = parse(version);
  const required = parse(minimum);
  if (!current || !required) return false;
  return current[0] > required[0]
    || (current[0] === required[0] && current[1] >= required[1]);
}
