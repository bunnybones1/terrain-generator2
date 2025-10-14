// Simple deterministic PRNG (Mulberry32) and helpers
export class PRNG {
  private state: number;
  constructor(seed: number) {
    // Force to uint32
    this.state = seed >>> 0;
    if (this.state === 0) {
      // avoid zero seed degeneracy
      this.state = 0x6d2b79f5;
    }
  }
  // Returns a float in [0,1)
  next = () => {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Float in [min, max)
  float(min = 0, max = 1): number {
    return min + (max - min) * this.next();
  }
  // Integer in [min, max] inclusive
  int(min: number, max: number): number {
    return Math.floor(this.float(min, max + 1));
  }
  // Sample uniformly in a disk of radius R; returns [x, y]
  inCircle(radius: number): [number, number] {
    const u = this.next();
    const r = radius * Math.sqrt(u);
    const theta = this.float(0, Math.PI * 2);
    return [Math.cos(theta) * r, Math.sin(theta) * r];
  }
}
