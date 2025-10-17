export function remapClamp(a: number, b: number, v: number): number {
  const t = (v - a) / (b - a);
  return Math.min(1, Math.max(0, t));
}
export function remap(a: number, b: number, v: number): number {
  return (v - a) / (b - a);
}

const result = [0, 0] as [number, number];
// simple hash to jitter point within cell
export function hash2(i: number, j: number) {
  // integer hashing then map to [0,1)
  let n = i * 374761393 + j * 668265263;
  n = (n ^ (n >> 13)) * 1274126177;
  n = (n ^ (n >> 16)) >>> 0;
  const r1 = (n & 0xffff) / 65536;
  const r2 = ((n >> 16) & 0xffff) / 65536;
  result[0] = r1;
  result[1] = r2;
  return result;
}

export function ridge(n: number): number {
  return (1 - Math.abs(n)) * (1 - Math.abs(n));
}
