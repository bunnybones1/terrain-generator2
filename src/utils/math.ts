export function remapClamp(a: number, b: number, v: number): number {
  const t = (v - a) / (b - a);
  return Math.min(1, Math.max(0, t));
}

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function remap(a: number, b: number, v: number): number {
  return (v - a) / (b - a);
}

export function lerp(a: number, b: number, v: number): number {
  return a + (b - a) * v;
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

// simple hash for deterministic random value 0..1
export function hash1(i: number) {
  // integer hashing then map to [0,1)
  let n = i * 668265263;
  n = (n ^ (n >> 13)) * 1274126177;
  n = (n ^ (n >> 16)) >>> 0;
  return (n & 0xffffffff) / 2147483648;
}

export function ridge(n: number): number {
  return (1 - Math.abs(n)) * (1 - Math.abs(n));
}

export function hash2i(xi: number, zi: number, k: number, seed: number): number {
  let h = xi * 374761393 + zi * 668265263 + (seed ^ (k * 1274126177));
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h;
}

export function rand01(xi: number, zi: number, k: number, seed: number): number {
  return hash2i(xi, zi, k, seed) / 4294967295;
}

export function unlerp(val: number, low: number, high: number) {
  return (val - low) / (high - low);
}

export function inRange(val: number, low: number, high: number) {
  return low < val && val < high;
}

export function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}
