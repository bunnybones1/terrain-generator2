export function remapClamp(a: number, b: number, v: number): number {
  const t = (v - a) / (b - a);
  return Math.min(1, Math.max(0, t));
}
export function remap(a: number, b: number, v: number): number {
  return (v - a) / (b - a);
}
