// Pack two signed 16-bit coords into one 32-bit integer key
// Valid when |cx|,|cz| < 32768
export function packKey16(cx: number, cz: number): number {
  const bx = (cx + 32768) & 0xffff;
  const bz = (cz + 32768) & 0xffff;
  return (bx << 16) | bz;
}
