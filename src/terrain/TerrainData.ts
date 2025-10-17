import { createNoise2D, NoiseFunction2D } from "simplex-noise";
import { PRNG } from "../utils/PRNG";
import { hash2, remapClamp, ridge } from "../utils/math";
import { smoothstep } from "three/src/math/MathUtils.js";

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

const pineCellSize = 4.0;
const pineMaxHeight = 12.0; // meters
const pineMinAltitude = 30;
const pineMaxAltitude = 60;
const pineAltitudeTransition = 10;
const pineEdge0 = pineMinAltitude - pineAltitudeTransition;
const pineEdge1 = pineMinAltitude;
const pineEdge2 = pineMaxAltitude;
const pineEdge3 = pineMaxAltitude + pineAltitudeTransition;

const results = { height: 0, baseHeight: 0, pine: 0, pineWindow: 0 };

const results3 = [0, 0, 0] as [number, number, number];

// 4 m grid cache sizes
const cacheGridSize = 4;

export type DirtyAABB = { minX: number; minZ: number; maxX: number; maxZ: number };

export class TerrainData {
  readonly config: TerrainConfig;
  private simplex: NoiseFunction2D;
  private maskSimplex: NoiseFunction2D;
  private rng: PRNG;

  private readonly baseHeightGridSize = cacheGridSize; // meters
  private readonly slopeGridSize = cacheGridSize; // meters

  // Paged cache configuration
  private static readonly PAGE_POT = 7; // 128x128 samples per page
  private static readonly PAGE_SIZE = 1 << TerrainData.PAGE_POT; // 128
  private static readonly PAGE_MASK = TerrainData.PAGE_SIZE - 1;

  private static packPageKey(px: number, pz: number): number {
    // pack signed 20-bit coords into a single number key
    const BITS = 20;
    const MASK = (1 << BITS) - 1;
    const X = (px & MASK) >>> 0;
    const Z = (pz & MASK) >>> 0;
    return X + Z * (MASK + 1);
  }

  private static pageIndex(lx: number, lz: number): number {
    return lz * TerrainData.PAGE_SIZE + lx;
  }

  private static makePage(): Float32Array {
    const arr = new Float32Array(TerrainData.PAGE_SIZE * TerrainData.PAGE_SIZE);
    // fill with NaN to detect missing values
    for (let i = 0; i < arr.length; i++) arr[i] = Number.NaN;
    return arr;
  }

  // Page maps
  private baseHeightPages = new Map<number, Float32Array>();
  private slopePages = new Map<number, Float32Array>();

  // Retrieve or create page for given page coords
  private getPage(map: Map<number, Float32Array>, px: number, pz: number): Float32Array {
    const key = TerrainData.packPageKey(px, pz);
    let page = map.get(key);
    if (!page) {
      page = TerrainData.makePage();
      map.set(key, page);
    }
    return page;
  }

  // Generic paged sample getter for grid coords (ix,iz)
  private getPagedSample(
    map: Map<number, Float32Array>,
    ix: number,
    iz: number,
    gridSize: number,
    compute: (wx: number, wz: number) => number
  ): number {
    // Compute page and local indices
    const px = ix >> TerrainData.PAGE_POT;
    const pz = iz >> TerrainData.PAGE_POT;
    const lx = ix & TerrainData.PAGE_MASK;
    const lz = iz & TerrainData.PAGE_MASK;

    const page = this.getPage(map, px, pz);
    const idx = TerrainData.pageIndex(lx, lz);
    let v = page[idx];
    if (Number.isNaN(v)) {
      const wx = ix * gridSize;
      const wz = iz * gridSize;
      v = compute(wx, wz);
      page[idx] = v;
    }
    return v;
  }

  // Dig layers at 0.5m doubling 6 times: 0.5,1,2,4,8,16,32
  private digLayers: DigLayer[] = [];
  // track dirty tiles affected by edits to trigger regeneration outside
  private dirtyTiles = new Set<string>();
  // world-space AABBs of modified areas to allow precise updates (e.g., reposition stones)
  private dirtyAABBs: DirtyAABB[] = [];

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
    // record precise world-space bounds for systems like stones to react
    this.dirtyAABBs.push({
      minX: cx - radius,
      minZ: cz - radius,
      maxX: cx + radius,
      maxZ: cz + radius,
    });

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

  // Consume and clear dirty AABBs
  popDirtyAABBs() {
    if (this.dirtyAABBs.length === 0) {
      return;
    }
    const arr = this.dirtyAABBs.slice();
    this.dirtyAABBs.length = 0;
    return arr;
  }

  // Get or compute base height at a grid point (ix,iz) using paged cache
  private getBaseHeightGridSample(ix: number, iz: number): number {
    return this.getPagedSample(this.baseHeightPages, ix, iz, this.baseHeightGridSize, (wx, wz) =>
      this.getBaseHeight(wx, wz)
    );
  }

  // Get or compute slope at a grid point (ix,iz) using paged cache
  private getSlopeGridSample(ix: number, iz: number): number {
    return this.getPagedSample(this.slopePages, ix, iz, this.slopeGridSize, (wx, wz) => {
      // Compute slope from approximated normal for stability
      const n = this.getNormalApprox(wx, wz);
      const ny = n[1];
      return Math.sqrt(Math.max(0, 1 - ny * ny)); // 0..1
    });
  }

  getBaseHeightApprox(x: number, z: number) {
    const s = this.baseHeightGridSize;
    const fx = x / s;
    const fz = z / s;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;

    // Fetch four neighboring cached samples (compute and cache if missing)
    const h00 = this.getBaseHeightGridSample(ix, iz);
    const h10 = this.getBaseHeightGridSample(ix + 1, iz);
    const h01 = this.getBaseHeightGridSample(ix, iz + 1);
    const h11 = this.getBaseHeightGridSample(ix + 1, iz + 1);

    // Bilinear interpolation
    const a = h00 * (1 - tx) + h10 * tx;
    const b = h01 * (1 - tx) + h11 * tx;
    return a * (1 - tz) + b * tz;
  }

  // World height in meters at x,z (meters)
  getBaseHeight(x: number, z: number) {
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
      const n = this.simplex(x * freq, z * freq); // -1..1
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
      const kn = this.simplex(x * kFreq, z * kFreq); // -1..1
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
      const n = this.simplex(x * freq, z * freq); // -1..1
      // Sharpen ridge response to emphasize carving
      const r = ridge(n); // 0..1
      sum += Math.pow(r, 1.5) * amp;
      ampSum += amp;
      freq *= lacunarity;
      amp *= gainRidge;
    }
    const ridgeNormalized = sum / Math.max(1e-6, ampSum); // ~0..1

    // Height-based factor: start erosion earlier and ramp faster for visibility
    // Smooth step from 10 -> 500 meters
    const t = remapClamp(10, 500, baseHeight); // 0..1
    const heightFactor = t * t * (3 - 2 * t); // smoothstep

    // Subtract valleys (spaces between ridges): valley = 1 - ridge
    const valleyStrength = 1 - ridgeNormalized;

    // Erosion amplitude in meters; stronger to make effect visible
    const erosion = valleyStrength * heightFactor;

    // Subtractive: carve away valleys more than ridges
    let height = baseHeight * (1 - erosion);

    // Add ridgeNormalized in deep regions: start at -10m, increase to max at -500m
    // Depth factor uses smoothstep from 0 -> -400 (note decreasing values)
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
        const n = this.simplex(x * hf, z * hf); // -1..1
        const r = ridge(n); // 0..1 ridge-like
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
    return height;
  }
  getSample(x: number, z: number) {
    const baseHeight = this.getBaseHeight(x, z);
    // Add pine trees: Worley-like cell peaks (~4m cells), up to 7m height,
    // only active between 20m..60m with 5m falloff on each side (i.e., 15..65 soft range).
    // Worley helper: distance to nearest pseudo-random feature point in each cell and its neighbors
    const fx = x / pineCellSize;
    const fz = z / pineCellSize;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const px = fx - ix;
    const pz = fz - iz;

    let minD = 1e9;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const [jx, jz] = hash2(ix + dx, iz + dz);
        const cx = dx + jx; // local cell center jittered
        const cz = dz + jz;
        const dxp = px - cx;
        const dzp = pz - cz;
        const d2 = dxp * dxp + dzp * dzp;
        if (d2 < minD) minD = d2;
      }
    }
    const d = Math.sqrt(minD); // 0..~1.2
    // Convert distance to a peak: nearest -> peak 1, farther -> 0
    const peak = Math.max(0, 1 - d); // wider/narrower by factor

    // Multi-octave ridge-like noise used to modulate pine edges
    const ridgeBaseScale = 1 / 500;
    const ridgeOctaves = 6;
    const lac = 2.0;
    const gain = 0.55;
    const ridgeSharp = 1.2;
    const anisotropy = 1.8;
    const angle = 0.35;

    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const rx = cosA * x - sinA * z;
    const rz = sinA * x + cosA * z;

    let f = ridgeBaseScale;
    let aOct = 1.0;
    let acc = 0;
    let accAmp = 0;
    for (let o = 0; o < ridgeOctaves; o++) {
      const nx = rx * f;
      const nz = (rz * f) / anisotropy;
      const n = this.simplex(nx, nz); // -1..1
      const r = ridge(n); // 0..1
      const rSharp = Math.pow(r, ridgeSharp);
      acc += rSharp * aOct;
      accAmp += aOct;
      f *= lac;
      aOct *= gain;
    }
    const ridgeN = accAmp > 0 ? acc / accAmp : 0; // 0..1

    // Edge modulation amounts in meters
    const upAmount = 20; // edges 0/1 go up by upAmount*r
    const downAmount = 180; // edges 2/3 go down by downAmount*r

    const edge0m = pineEdge0 - upAmount * ridgeN;
    const edge1m = pineEdge1 - upAmount * ridgeN;
    const edge2m = pineEdge2 + downAmount * ridgeN;
    const edge3m = pineEdge3 + downAmount * ridgeN;

    // Use modulated edges
    const rise = smoothstep(baseHeight, edge0m, edge1m);
    const fall = 1 - smoothstep(baseHeight, edge2m, edge3m);

    // pinePower: 1 fully inside band, ramps 0->1 entering, 1->0 exiting, 0 outside
    let pineWindow = 0;
    if (baseHeight <= edge0m || baseHeight >= edge3m) {
      pineWindow = 0;
    } else if (baseHeight < edge1m) {
      pineWindow = rise;
    } else if (baseHeight > edge2m) {
      pineWindow = fall;
    } else {
      pineWindow = 1;
    }

    if (pineWindow > 0) {
      // Attenuate pinePower on slopes: start reducing at 0.3, zero by 0.5
      const slope = this.getSlopeApprox(x, z);
      const slopeAtten = 1 - smoothstep(slope, 0.3, 0.4);
      pineWindow *= slopeAtten;
    }

    // Unadjusted pine peak contribution (above ground)
    const pinePeak = peak * pineMaxHeight;
    const pineTop = baseHeight + pinePeak;

    // In transition, slide peaks down towards the ground as we leave the window,
    // with zero slide fully inside the band and full slide outside. Never go below ground.
    const slideDown = (1 - pineWindow) * pineMaxHeight; // 0 inside, full outside
    const pineAdjustedTop = pineTop - slideDown;

    // Clamp against ground so we don't invert: max with current ground 'height'
    const heightWithPine = Math.max(baseHeight, pineAdjustedTop);

    results.baseHeight = baseHeight;
    const pine = heightWithPine - baseHeight;
    results.height = heightWithPine;
    results.pine = pine;
    results.pineWindow = pineWindow;

    return results;
  }

  getSplatWeights(x: number, z: number): [number, number, number, number] {
    // Simple RGBA mask: grass in G channel from low slopes/heights, rock in R for steep/high
    const h = this.getSample(x, z).height;
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
    const hL = this.getBaseHeight(x - eps, z);
    const hR = this.getBaseHeight(x + eps, z);
    const hD = this.getBaseHeight(x, z - eps);
    const hU = this.getBaseHeight(x, z + eps);
    // normal from gradient
    const nx = hL - hR;
    const ny = 2 * eps;
    const nz = hD - hU;
    const invLen = 1 / Math.hypot(nx, ny, nz);
    results3[0] = nx * invLen;
    results3[1] = ny * invLen;
    results3[2] = nz * invLen;
    return results3;
  }

  getNormalApprox(x: number, z: number): [number, number, number] {
    const eps = 0.5;
    const hL = this.getBaseHeightApprox(x - eps, z);
    const hR = this.getBaseHeightApprox(x + eps, z);
    const hD = this.getBaseHeightApprox(x, z - eps);
    const hU = this.getBaseHeightApprox(x, z + eps);
    // normal from gradient
    const nx = hL - hR;
    const ny = 2 * eps;
    const nz = hD - hU;
    const invLen = 1 / Math.hypot(nx, ny, nz);
    results3[0] = nx * invLen;
    results3[1] = ny * invLen;
    results3[2] = nz * invLen;
    return results3;
  }

  getSlope(x: number, z: number): number {
    const n = this.getNormal(x, z);
    // slope = sin(theta) = sqrt(1 - ny^2), return 0..1
    const ny = n[1];
    return Math.sqrt(Math.max(0, 1 - ny * ny));
  }

  // Bilinearly interpolated slope from 4m slope cache
  getSlopeApprox(x: number, z: number): number {
    const s = this.slopeGridSize;
    const fx = x / s;
    const fz = z / s;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;

    // Fetch four neighboring cached slope samples
    const s00 = this.getSlopeGridSample(ix, iz);
    const s10 = this.getSlopeGridSample(ix + 1, iz);
    const s01 = this.getSlopeGridSample(ix, iz + 1);
    const s11 = this.getSlopeGridSample(ix + 1, iz + 1);

    // Bilinear interpolation
    const a = s00 * (1 - tx) + s10 * tx;
    const b = s01 * (1 - tx) + s11 * tx;
    return a * (1 - tz) + b * tz;
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
