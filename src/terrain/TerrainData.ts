import { createNoise2D, NoiseFunction2D } from "simplex-noise";
import { PRNG } from "../utils/PRNG";
import { remapClamp } from "../utils/math";

export type TerrainMaterialConfig = {
  splatScale?: number;
};

export type TerrainConfig = {
  tileSize: number; // meters per tile
  tileResolution: number; // vertices per side (power of two plus one recommended)
  minLOD: number;
  maxLOD: number;
  screenSpaceError: number;
  material?: TerrainMaterialConfig;
};

export type TileKey = string; // `${tx}:${tz}:${lod}`

export type TileCoords = {
  tx: number;
  tz: number;
  lod: number;
};

type DigLayer = {
  cellSize: number; // meters per cell
  // keyed by `${ix}:${iz}`
  cells: Map<string, number>;
};

export class TerrainData {
  readonly config: TerrainConfig;
  private simplex: NoiseFunction2D;
  private maskSimplex: NoiseFunction2D;
  private rng: PRNG;

  // Dig layers at 0.5m doubling 6 times: 0.5,1,2,4,8,16,32
  private digLayers: DigLayer[] = [];
  // track dirty tiles affected by edits to trigger regeneration outside
  private dirtyTiles = new Set<string>();

  constructor(config: TerrainConfig, seed = 1337) {
    void seed;
    this.config = config;
    this.rng = new PRNG(seed);
    this.simplex = createNoise2D(this.rng.next);
    this.maskSimplex = createNoise2D(this.rng.next);
    this.initDigLayers();
  }

  private initDigLayers() {
    const start = 0.5;
    const count = 7; // 0.5 * 2^6
    this.digLayers.length = 0;
    for (let i = 0; i < count; i++) {
      this.digLayers.push({
        cellSize: start * Math.pow(2, i),
        cells: new Map(),
      });
    }
  }

  // Sample combined dig depth at world x,z by bilinear interpolation in each layer
  private sampleDig(x: number, z: number): number {
    let d = 0;
    for (const layer of this.digLayers) {
      d += this.sampleDigLayer(layer, x, z);
    }
    return d;
  }

  private sampleDigLayer(layer: DigLayer, x: number, z: number): number {
    const s = layer.cellSize;
    const fx = x / s;
    const fz = z / s;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;

    // fetch four neighbors
    const v00 = this.getDigCell(layer, ix, iz);
    const v10 = this.getDigCell(layer, ix + 1, iz);
    const v01 = this.getDigCell(layer, ix, iz + 1);
    const v11 = this.getDigCell(layer, ix + 1, iz + 1);

    // bilinear
    const a = v00 * (1 - tx) + v10 * tx;
    const b = v01 * (1 - tx) + v11 * tx;
    return a * (1 - tz) + b * tz;
  }

  private getDigCell(layer: DigLayer, ix: number, iz: number): number {
    const key = `${ix}:${iz}`;
    const v = layer.cells.get(key);
    return v ?? 0;
  }

  private setDigCell(layer: DigLayer, ix: number, iz: number, value: number) {
    const key = `${ix}:${iz}`;
    if (value <= 1e-5) {
      // clear near-zero to keep memory small
      if (layer.cells.has(key)) layer.cells.delete(key);
    } else {
      layer.cells.set(key, value);
    }
  }

  // Write a spherical depression centered at (x,z) with radius r and depth h (positive depth)
  // digSize approximates radius; choose layer whose cellSize is closest to r/6
  addDigSphere(x: number, z: number, radius: number, depth: number) {
    const targetCell = Math.max(0.5, radius / 6);
    let best = 0;
    let bestErr = Infinity;
    for (let i = 0; i < this.digLayers.length; i++) {
      const e = Math.abs(this.digLayers[i].cellSize - targetCell);
      if (e < bestErr) {
        bestErr = e;
        best = i;
      }
    }
    const layer = this.digLayers[best];
    this.rasterizeSphereToLayer(layer, x, z, radius, depth);

    // mark dirty tiles intersecting the dig for later regeneration
    this.markDirtyTilesForSphere(x, z, radius);
  }

  private rasterizeSphereToLayer(
    layer: DigLayer,
    cx: number,
    cz: number,
    radius: number,
    depth: number
  ) {
    const s = layer.cellSize;
    // determine affected cell range
    const minX = Math.floor((cx - radius) / s);
    const maxX = Math.floor((cx + radius) / s);
    const minZ = Math.floor((cz - radius) / s);
    const maxZ = Math.floor((cz + radius) / s);

    for (let iz = minZ; iz <= maxZ; iz++) {
      for (let ix = minX; ix <= maxX; ix++) {
        // cell center
        const wx = (ix + 0.5) * s;
        const wz = (iz + 0.5) * s;
        const dx = wx - cx;
        const dz = wz - cz;
        const dist = Math.hypot(dx, dz);
        if (dist <= radius) {
          // spherical cap: y = depth * (1 - (r^2 - d^2)/r^2)^0.5? Better: hemisphere projected.
          // Simpler: smooth falloff: depth * (1 - (dist/r)^2)^0.5 to resemble spherical depression
          const t = dist / Math.max(1e-6, radius);
          const amount = depth * Math.sqrt(Math.max(0, 1 - t * t));
          // accumulate additively so repeated digs deepen the depression
          const prev = this.getDigCell(layer, ix, iz);
          const next = prev + amount;
          this.setDigCell(layer, ix, iz, next);
        }
      }
    }
  }

  private markDirtyTilesForSphere(cx: number, cz: number, radius: number) {
    // Check all LODs because renderer may be showing any
    for (let lod = this.config.minLOD; lod <= this.config.maxLOD; lod++) {
      const size = this.config.tileSize * Math.pow(2, lod);
      const minTx = Math.floor((cx - radius) / size);
      const maxTx = Math.floor((cx + radius) / size);
      const minTz = Math.floor((cz - radius) / size);
      const maxTz = Math.floor((cz + radius) / size);
      for (let tz = minTz; tz <= maxTz; tz++) {
        for (let tx = minTx; tx <= maxTx; tx++) {
          this.dirtyTiles.add(`${tx}:${tz}:${lod}`);
        }
      }
    }
  }

  // Consume and clear dirty tiles
  popDirtyTiles(): string[] {
    const arr = Array.from(this.dirtyTiles);
    this.dirtyTiles.clear();
    return arr;
  }

  // World height in meters at x,z (meters)
  getHeight(x: number, z: number): number {
    // Simple 6-octave low-frequency fractal Brownian motion (fBm)
    const baseFreq = 1 / 8196; // very low frequency for broad features
    const octavesBase = 7;
    const octavesRidges = 12;
    const lacunarity = 2.0;
    const gainBase = 0.5;
    const gainRidge = 0.5;

    // Base fBm
    let freq = baseFreq;
    let amp = 1.0;
    let sum = 0;
    let ampSum = 0;

    for (let i = 0; i < octavesBase; i++) {
      const n = this.noise2d(x * freq, z * freq); // -1..1
      sum += n * amp;
      ampSum += amp;
      freq *= lacunarity;
      amp *= gainBase;
    }
    const baseNormalized = sum / Math.max(1e-6, ampSum); // ~-1..1
    // Compute a dynamic k using a separate 6-octave fBm in [0, 0.8]
    let kFreq = baseFreq * 0.75; // slight variation from base
    let kAmp = 1.0;
    let kSum = 0;
    let kAmpSum = 0;
    for (let i = 0; i < octavesBase; i++) {
      const kn = this.noise2d(x * kFreq, z * kFreq); // -1..1
      kSum += kn * kAmp;
      kAmpSum += kAmp;
      kFreq *= lacunarity;
      kAmp *= gainBase;
    }
    const kNorm = kSum / Math.max(1e-6, kAmpSum); // ~-1..1
    const k01 = (kNorm + 1) * 0.5; // 0..1
    const kDynamic = k01 * 0.8; // 0..0.8

    // Ease into a plateau near 0: flatten near 0, preserve endpoints -1 and 1 exactly.
    // Symmetric easing around 0 with a ramp that fades out towards |a|=1.
    const sign = Math.sign(baseNormalized);
    const a = Math.abs(baseNormalized); // 0..1

    // Ramp that is 0 near 0 and ->1 near 1 to turn off easing towards the ends
    // r(a) = smoothstep(edge0, edge1, a); choose edge0 small so only near-center is flattened
    const edge0 = -0.2;
    const edge1 = 0.7;
    const tRamp = Math.min(1, Math.max(0, (a - edge0) / Math.max(1e-6, edge1 - edge0)));
    const ramp = tRamp * tRamp * (3 - 2 * tRamp); // smoothstep

    // Apply easing strength only where ramp is low (near center). At a=1, ramp=1 -> no change.
    // e(a) = a * (1 - k*(1 - ramp))
    const eased = a * (1 - kDynamic * (1 - ramp));
    const baseEased = sign * eased;

    // Remap magnitudes so values in [0, 0.5] dip slightly with a smooth curve.
    // This preserves continuity and leaves |x| >= 0.5 unchanged.
    const s = Math.sign(baseEased);
    const a0 = Math.abs(baseEased); // 0..1
    let aDip = a0;
    if (a0 < 0.5) {
      const t0 = a0 / 0.5; // 0..1 over [0,0.5]
      const smooth = t0 * t0 * (3 - 2 * t0); // smoothstep
      const dipAmount = 0.68; // how much to dip at t0=0.5 (soft)
      // Interpolate from original a0 to a reduced value a0*(1 - dipAmount) using smooth curve
      aDip = a0 * (1 - dipAmount * (1 - smooth));
    }
    const baseRemapped = s * aDip;
    const baseHeight = baseRemapped * 1500; // meters

    // Ridge fBm (shifted to slightly higher frequencies), normalized to ~0..1
    freq = baseFreq * 2; // shift one octave up for sharper detail
    amp = 1.0;
    sum = 0;
    ampSum = 0;
    for (let i = 0; i < octavesRidges; i++) {
      const n = this.noise2d(x * freq, z * freq); // -1..1
      // Sharpen ridge response to emphasize carving
      const r = this.ridge(n); // 0..1
      sum += Math.pow(r, 1.5) * amp;
      ampSum += amp;
      freq *= lacunarity;
      amp *= gainRidge;
    }
    const ridgeNormalized = sum / Math.max(1e-6, ampSum); // ~0..1

    // Height-based factor: start erosion earlier and ramp faster for visibility
    // Smooth step from 50 -> 350 meters
    const t = remapClamp(10, 500, baseHeight); // 0..1
    const heightFactor = t * t * (3 - 2 * t); // smoothstep

    // Subtract valleys (spaces between ridges): valley = 1 - ridge
    const valleyStrength = 1 - ridgeNormalized;

    // Erosion amplitude in meters; stronger to make effect visible
    const erosion = valleyStrength * heightFactor;

    // Subtractive: carve away valleys more than ridges
    let height = baseHeight * (1 - erosion);

    // Add ridgeNormalized in deep regions: start at -10m, increase to max at -500m
    // Depth factor uses smoothstep from -10 -> -500 (note decreasing values)
    const depthT = remapClamp(0, -400, height); // 0 at -10, 1 at -500
    const depthFactor = depthT * depthT * (3 - 2 * depthT); // smoothstep

    const deepRidgeAmplitude = 300; // tune contribution strength
    const deepAddition = ridgeNormalized * ridgeNormalized * deepRidgeAmplitude * depthFactor;

    height += deepAddition;

    // Add multi-octave ridge-shaped hills for heights between 10m and 50m,
    // but subtract them at the end to create carved, rolling forms.
    {
      const hillsBaseFreq = baseFreq * 8; // mid-frequency relative to base
      const hillsOctaves = 9;
      let hf = hillsBaseFreq;
      let ha = 1.0;
      let hsum = 0;
      let hampSum = 0;
      for (let i = 0; i < hillsOctaves; i++) {
        const n = this.noise2d(x * hf, z * hf); // -1..1
        const r = this.ridge(n); // 0..1 ridge-like
        hsum += Math.pow(r, 1.25) * ha; // slight sharpening
        hampSum += ha;
        hf *= 2.0;
        ha *= 0.5;
      }
      const hillsN = hsum / Math.max(1e-6, hampSum); // 0..1
      // Ramp factor from 10m to 50m; using current height after previous mods
      const tH = remapClamp(-10, 50, height);
      const ramp = tH * tH * (3 - 2 * tH); // smoothstep
      const hillsAmplitude = 50; // meters; tune shape intensity
      // Subtractive application
      height -= hillsN * hillsAmplitude * ramp;
    }

    // Subtract dig layers
    const dig = this.sampleDig(x, z);
    height -= dig;

    // Clamp to desired range
    // height = Math.max(-500, Math.min(500, height));
    return height;
  }

  getSplatWeights(x: number, z: number): [number, number, number, number] {
    // Simple RGBA mask: grass in G channel from low slopes/heights, rock in R for steep/high
    const h = this.getHeight(x, z);
    const slope = this.getSlope(x, z);
    // Adapt thresholds to new height range [-500, 500]
    const g = remapClamp(0.0, 0.6, 1 - slope) * remapClamp(-300, 150, 150 - Math.abs(h));
    const r = remapClamp(0.2, 1.0, slope) * remapClamp(80, 400, Math.abs(h));
    const b = remapClamp(0.0, 1.0, this.maskNoise(x, z));
    const a = Math.max(0, 1 - (r + g + b));
    // Normalize to 0..1
    const sum = r + g + b + a + 1e-5;
    return [r / sum, g / sum, b / sum, a / sum];
  }

  getNormal(x: number, z: number): [number, number, number] {
    const eps = 0.5;
    const hL = this.getHeight(x - eps, z);
    const hR = this.getHeight(x + eps, z);
    const hD = this.getHeight(x, z - eps);
    const hU = this.getHeight(x, z + eps);
    // normal from gradient
    const nx = hL - hR;
    const ny = 2 * eps;
    const nz = hD - hU;
    const invLen = 1 / Math.hypot(nx, ny, nz);
    return [nx * invLen, ny * invLen, nz * invLen];
  }

  getSlope(x: number, z: number): number {
    const n = this.getNormal(x, z);
    // slope = sin(theta) = sqrt(1 - ny^2), return 0..1
    const ny = n[1];
    return Math.sqrt(Math.max(0, 1 - ny * ny));
  }

  worldToTileCoords(x: number, z: number, lod: number): { tx: number; tz: number } {
    const size = this.config.tileSize * Math.pow(2, lod);
    return {
      tx: Math.floor(x / size),
      tz: Math.floor(z / size),
    };
  }

  tileKey(t: TileCoords): TileKey {
    return `${t.tx}:${t.tz}:${t.lod}`;
  }

  tileWorldOrigin(t: TileCoords): { x: number; z: number; size: number } {
    const size = this.config.tileSize * Math.pow(2, t.lod);
    return { x: t.tx * size, z: t.tz * size, size };
  }

  // Helpers
  private noise2d(x: number, z: number): number {
    return this.simplex(x, z);
  }
  private ridge(n: number): number {
    return (1 - Math.abs(n)) * (1 - Math.abs(n));
  }
  private maskNoise(x: number, z: number): number {
    const s = 1 / 40;
    return (this.maskSimplex(x * s, z * s) + 1) * 0.5;
  }
}

export function screenSpaceErrorToLOD(
  distance: number,
  baseTileSize: number,
  fovY: number,
  screenHeight: number,
  min: number,
  max: number
): number {
  // Larger distance -> higher LOD index. Tune constant to reach min..max across practical ranges.
  const metersPerPixel =
    (2 * distance * Math.tan((fovY * Math.PI) / 360)) / Math.max(1, screenHeight);
  // Target: when a tile spans about N pixels on screen, increase LOD.
  // Using 4 as base pixels threshold gives more aggressive LODing at distance.
  const pixelsPerBaseTile = baseTileSize / Math.max(1e-6, metersPerPixel);
  const lod = Math.max(
    min,
    Math.min(
      max,
      Math.floor(Math.log2(Math.max(1, 256 / pixelsPerBaseTile))) // 256px per tile ~ LOD 0, halves each step
    )
  );
  return lod;
}
