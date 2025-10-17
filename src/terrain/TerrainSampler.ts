import { TerrainData } from "./TerrainData";

export class TerrainSampler {
  constructor(public data: TerrainData) {}

  getSample(x: number, z: number) {
    return this.data.getSample(x, z);
  }

  getNormal(x: number, z: number): [number, number, number] {
    return this.data.getNormal(x, z);
  }

  getSlope(x: number, z: number): number {
    return this.data.getSlope(x, z);
  }
  getSlopeApprox(x: number, z: number): number {
    return this.data.getSlopeApprox(x, z);
  }

  getSplatWeights(x: number, z: number): [number, number, number, number] {
    return this.data.getSplatWeights(x, z);
  }

  raycast(
    origin: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    maxDist = 1000,
    step = 0.5
  ): { hit: boolean; point?: { x: number; y: number; z: number } } {
    // Simple marching raycast against heightfield, not optimized.
    let t = 0;
    while (t < maxDist) {
      const x = origin.x + dir.x * t;
      const z = origin.z + dir.z * t;
      const y = origin.y + dir.y * t;
      const h = this.getSample(x, z).height;
      if (y <= h) {
        return { hit: true, point: { x, y: h, z } };
      }
      t += step;
    }
    return { hit: false };
  }
}
