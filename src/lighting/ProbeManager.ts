import {
  Vector3,
  DataTexture,
  RGBAFormat,
  FloatType,
  ClampToEdgeWrapping,
  NearestFilter,
  Color,
  Texture,
} from "three";
import { TerrainData } from "../terrain/TerrainData";
import { remapClamp } from "../utils/math";

// Per-level debug tint to visualize different grid sizes

const GREEN = new Color(0.2, 1.5, 0);

export class ProbeManager {
  // configuration
  readonly maxDistance = 16; // metres
  readonly shCoeffs = 9; // L2

  private atlas: DataTexture;
  // Shared layout configuration common to all levels
  private sharedLayoutConfig = {
    texelsPerProbe: 4,
    probesPerAxis: -1, // number of probes per axis (uniform across levels)
    probesPerLevel: -1, // probesPerAxis^3
    texelsPerLevel: -1, // probesPerLevel * texelsPerProbe
    totalLevels: 8,
    atlasSize: 1024,
    baseSpacing: 1,
  };

  private terrainData: TerrainData;
  private writeQueue: { wx: number; wy: number; wz: number; li: number; d2: number }[] = [];
  private writeQueueSet: Set<string> = new Set();
  private lastCameraCell = new Vector3();

  private compareQueue(a: { li: number; d2: number }, b: { li: number; d2: number }) {
    if (a.li !== b.li) return a.li - b.li;
    return a.d2 - b.d2;
  }

  // Simple hemisphere colors for mock GI
  // private hemiTop = new Color(1.0, 1.0, 1.0);
  private hemiTop = new Color(0.6, 0.7, 1.0);
  // private hemiBottom = new Color(0.0, 0.0, 0.0);
  // private hemiBottom = new Color(0.4, 0.25, 0.1);
  private hemiBottom = new Color(0.1, 0.0625, 0.025);

  constructor(terrainData: TerrainData) {
    this.terrainData = terrainData;

    const config = this.sharedLayoutConfig;
    // Setup atlas texture (float for precision)
    const size = config.atlasSize;
    const data = new Float32Array(size * size * 4);
    this.atlas = new DataTexture(data, size, size, RGBAFormat, FloatType);
    this.atlas.wrapS = this.atlas.wrapT = ClampToEdgeWrapping;
    this.atlas.minFilter = NearestFilter;
    this.atlas.magFilter = NearestFilter;
    this.atlas.needsUpdate = true;

    // Build flat-packed 1D layout across all levels (uniform count across levels)
    // Choose ring-buffer size based on base level, doubling coverage per level but keeping cubic count identical
    // so that modulo addressing is consistent and packing is uniform.
    const baseCoverage = this.maxDistance * 2;
    const probesPerAxis = Math.floor(baseCoverage / config.baseSpacing);
    config.probesPerAxis = probesPerAxis;
    config.probesPerLevel = probesPerAxis * probesPerAxis * probesPerAxis;
    config.texelsPerLevel = config.probesPerLevel * config.texelsPerProbe;

    const totalRequiredTexels = config.texelsPerLevel * config.totalLevels;

    // Capacity check: required probe texels vs atlas pixels
    const atlasPixels = size * size;
    if (totalRequiredTexels > atlasPixels) {
      console.warn(
        `[ProbeManager] Probe atlas capacity exceeded: required texels=${totalRequiredTexels}, atlas pixels=${atlasPixels}. ` +
          `Increase atlasSize or reduce levels/coverage/texelPerProbe.`
      );
    } else {
      console.log(
        `[ProbeManager] Probe atlas capacity OK: required texels=${totalRequiredTexels}/${atlasPixels} (${(
          (totalRequiredTexels / atlasPixels) *
          100
        ).toFixed(1)}% used)`
      );
    }
  }

  getAtlasTexture(): Texture {
    return this.atlas;
  }

  getSharedLayoutConfig() {
    // Shared: [texelsPerProbe, count, probesPerLevel, texelsPerLevel, totalLevels, atlasSize, baseSpacing]
    return new Float32Array([
      this.sharedLayoutConfig.texelsPerProbe,
      this.sharedLayoutConfig.probesPerAxis,
      this.sharedLayoutConfig.probesPerLevel,
      this.sharedLayoutConfig.texelsPerLevel,
      this.sharedLayoutConfig.totalLevels,
      this.sharedLayoutConfig.atlasSize,
      this.sharedLayoutConfig.baseSpacing,
    ]);
  }

  update(cameraPos: Vector3) {
    // If camera moved in world, add only new probes caused by modulus jump per level
    const prevWorld = this.lastCameraCell.clone(); // reuse vector for prev world pos
    if (!prevWorld.equals(cameraPos)) {
      prevWorld.copy(this.lastCameraCell);
      this.lastCameraCell.copy(cameraPos);
      this.onCameraMoved(prevWorld, cameraPos);
      // Recompute distances and resort entire queue for new camera position
      for (let i = 0; i < this.writeQueue.length; i++) {
        const it = this.writeQueue[i];
        it.d2 =
          (it.wx - cameraPos.x) * (it.wx - cameraPos.x) +
          (it.wy - cameraPos.y) * (it.wy - cameraPos.y) +
          (it.wz - cameraPos.z) * (it.wz - cameraPos.z);
      }
      this.writeQueue.sort((a, b) => this.compareQueue(a, b));
    }

    // Process a few items per frame
    const budget = 64; // probes per frame across all levels
    for (let i = 0; i < budget && this.writeQueue.length > 0; i++) {
      const job = this.writeQueue.shift()!;
      this.bakeProbe(job.wx, job.wy, job.wz, job.li);
      // remove from dedupe set for its ring-buffer key to allow future refreshes of same slot
      const key = this.keyFor(job.wx, job.wy, job.wz, job.li);
      this.writeQueueSet.delete(key);
    }
  }

  private computeRingIndices(wx: number, wy: number, wz: number, levelIndex: number) {
    const spacing = this.sharedLayoutConfig.baseSpacing * Math.pow(2, levelIndex);
    const probesPerAxis = this.sharedLayoutConfig.probesPerAxis;

    const ixWorld = Math.floor(wx / spacing);
    const iyWorld = Math.floor(wy / spacing);
    const izWorld = Math.floor(wz / spacing);

    const ix = ((ixWorld % probesPerAxis) + probesPerAxis) % probesPerAxis;
    const iy = ((iyWorld % probesPerAxis) + probesPerAxis) % probesPerAxis;
    const iz = ((izWorld % probesPerAxis) + probesPerAxis) % probesPerAxis;

    return { ix, iy, iz, count: probesPerAxis };
  }

  private keyFor(wx: number, wy: number, wz: number, levelIndex: number): string {
    const idx = this.computeRingIndices(wx, wy, wz, levelIndex);
    return `${levelIndex}:${idx.ix},${idx.iy},${idx.iz}`;
  }

  private enqueueProbe(wx: number, wy: number, wz: number, li: number, cameraPos: Vector3) {
    const key = this.keyFor(wx, wy, wz, li);
    if (this.writeQueueSet.has(key)) return;
    // distance squared
    const d2 =
      (wx - cameraPos.x) * (wx - cameraPos.x) +
      (wy - cameraPos.y) * (wy - cameraPos.y) +
      (wz - cameraPos.z) * (wz - cameraPos.z);
    // binary insert to keep sorted by level first, then ascending distance
    let lo = 0;
    let hi = this.writeQueue.length;
    const newItem = { wx, wy, wz, li, d2 };
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const cmp = this.compareQueue(this.writeQueue[mid], newItem);
      if (cmp <= 0) lo = mid + 1;
      else hi = mid;
    }
    this.writeQueue.splice(lo, 0, newItem);
    this.writeQueueSet.add(key);
  }

  private onCameraMoved(prevWorld: Vector3, newWorld: Vector3) {
    // For each level, when camera crosses a level-specific grid cell boundary, new world grid cells enter range on the side moved toward.
    const config = this.sharedLayoutConfig;
    for (let li = 0; li < config.totalLevels; li++) {
      const spacing = config.baseSpacing * Math.pow(2, li);
      const spaceLimit = spacing * 4;

      // Previous and new snapped centers to this level's grid
      const prevCx = Math.floor(prevWorld.x / spacing) * spacing;
      const prevCy = Math.floor(prevWorld.y / spacing) * spacing;
      const prevCz = Math.floor(prevWorld.z / spacing) * spacing;
      const newCx = Math.floor(newWorld.x / spacing) * spacing;
      const newCy = Math.floor(newWorld.y / spacing) * spacing;
      const newCz = Math.floor(newWorld.z / spacing) * spacing;

      const extent = this.maxDistance * Math.pow(2, li);
      const maxRX = Math.ceil(extent / spacing);
      const maxRY = Math.ceil(extent / spacing);

      // Determine delta in level grid units
      const dxCells = (newCx - prevCx) / spacing;
      const dyCells = (newCy - prevCy) / spacing;
      const dzCells = (newCz - prevCz) / spacing;

      // Handle multiple cell skips by stepping one slab at a time
      const stepX = Math.sign(dxCells);
      const stepY = Math.sign(dyCells);
      const stepZ = Math.sign(dzCells);

      // X slabs
      for (let s = 0; s !== dxCells; s += stepX) {
        if (stepX === 0) break;
        const cx = prevCx + (s + stepX) * spacing;
        const cz = newCz;
        const enterX = cx + stepX * maxRX * spacing;
        for (let dy = -maxRY; dy <= maxRY; dy++) {
          for (let dz = -maxRX; dz <= maxRX; dz++) {
            const wx = enterX;
            const wy = newCy + dy * spacing;
            const wz = cz + dz * spacing;
            const terrain = this.terrainData.getSample(wx, wz);
            if (
              Math.abs(terrain.baseHeight - wy) > spaceLimit &&
              Math.abs(terrain.height - wy) > spaceLimit
            )
              continue;
            this.enqueueProbe(wx, wy, wz, li, newWorld);
          }
        }
      }

      // Z slabs
      for (let s = 0; s !== dzCells; s += stepZ) {
        if (stepZ === 0) break;
        const cx = newCx;
        const cz = prevCz + (s + stepZ) * spacing;
        const enterZ = cz + stepZ * maxRX * spacing;
        for (let dy = -maxRY; dy <= maxRY; dy++) {
          for (let dx = -maxRX; dx <= maxRX; dx++) {
            const wx = cx + dx * spacing;
            const wy = newCy + dy * spacing;
            const wz = enterZ;
            const terrain = this.terrainData.getSample(wx, wz);
            if (
              Math.abs(terrain.baseHeight - wy) > spaceLimit &&
              Math.abs(terrain.height - wy) > spaceLimit
            )
              continue;
            this.enqueueProbe(wx, wy, wz, li, newWorld);
          }
        }
      }

      // Y slabs
      for (let s = 0; s !== dyCells; s += stepY) {
        if (stepY === 0) break;
        const cx = newCx;
        const cy = prevCy + (s + stepY) * spacing;
        const enterY = cy + stepY * maxRY * spacing;
        for (let dz = -maxRX; dz <= maxRX; dz++) {
          for (let dx = -maxRX; dx <= maxRX; dx++) {
            const wx = cx + dx * spacing;
            const wy = enterY;
            const wz = newCz + dz * spacing;
            const terrain = this.terrainData.getSample(wx, wz);
            if (
              Math.abs(terrain.baseHeight - wy) > spaceLimit &&
              Math.abs(terrain.height - wy) > spaceLimit
            )
              continue;
            this.enqueueProbe(wx, wy, wz, li, newWorld);
          }
        }
      }
    }
  }

  initQueue(cameraPos: Vector3) {
    this.lastCameraCell.copy(cameraPos); // reuse vector for prev world pos
    this.writeQueue.length = 0;
    const config = this.sharedLayoutConfig;
    this.writeQueueSet.clear();
    for (let li = 0; li < config.totalLevels; li++) {
      const spacing = config.baseSpacing * Math.pow(2, li);
      const tolerance = spacing * 2;

      // Use radius based on maxDistance for all levels; wrapping will map into ring buffer
      const extent = this.maxDistance * Math.pow(2, li);

      // Center snapped to grid
      const cx = Math.floor(cameraPos.x / spacing) * spacing;
      const cy = Math.floor(cameraPos.y / spacing) * spacing;
      const cz = Math.floor(cameraPos.z / spacing) * spacing;

      const maxRX = Math.ceil(extent / spacing);
      const maxRY = Math.ceil(extent / spacing);
      const maxR = Math.max(maxRX, maxRY);

      // 3D shell traversal
      for (let r = 0; r <= maxR; r++) {
        for (let dy = -Math.min(r, maxRY); dy <= Math.min(r, maxRY); dy++) {
          for (let dz = -Math.min(r, maxRX); dz <= Math.min(r, maxRX); dz++) {
            for (let dx = -Math.min(r, maxRX); dx <= Math.min(r, maxRX); dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
              const wx = cx + dx * spacing;
              const wy = cy + dy * spacing;
              const wz = cz + dz * spacing;

              // Skip if terrain height at (wx,wz) is not within grid size of probe Y
              const terrainH = this.terrainData.getBaseHeight(wx, wz);
              if (Math.abs(terrainH - wy) > tolerance) continue;

              this.enqueueProbe(wx, wy, wz, li, cameraPos);
            }
          }
        }
      }
    }
    console.log(`initial probe queue: ${this.writeQueue.length}`);
  }

  // Bake a single probe irradiance and write to atlas
  private bakeProbe(wx: number, wy: number, wz: number, levelIndex: number) {
    const config = this.sharedLayoutConfig;
    // Mock irradiance using hemisphere colors; vary with height slightly too
    // const irrBase = new Color().lerpColors(this.hemiBottom, this.hemiTop, upFactor);
    const terrain = this.terrainData.getSample(wx, wz);
    // Green influence as ratio of proximity within 24 units to either baseHeight or height
    const window = 12;
    const dBase = Math.abs(wy - terrain.baseHeight);
    const dTop = Math.abs(wy - terrain.height);
    const rBase = 1 - Math.min(dBase / window, 1);
    const rTop = 1 - Math.min(dTop / window, 1);
    const pineRatio = Math.max(0, Math.min(terrain.pineWindow / 10, 1));
    const inTheWoods = Math.max(rBase, rTop) * pineRatio;

    const groundSkyRatio = remapClamp(terrain.height, terrain.height + 4, wy);

    const irrBase = this.hemiBottom.clone().lerp(this.hemiTop, groundSkyRatio);

    // const tint = debugTints[Math.min(levelIndex, debugTints.length - 1)];
    // const irr = irrBase.multiply(tint).lerp(GREEN, inTheWoods);
    // const irr = irrBase;//.lerp(GREEN, inTheWoods * 0.25);
    const irr = irrBase.lerp(GREEN, inTheWoods * 0.75);
    irr.multiplyScalar(0.25);

    // Write 3 texels per probe using global flat 1D packing (row-major in atlas)
    const spacing = config.baseSpacing * Math.pow(2, levelIndex);
    const probesPerAxis = this.sharedLayoutConfig.probesPerAxis;

    // Compute ring-buffer indices by snapping to grid and applying modulo
    const ixWorld = Math.floor(wx / spacing);
    const iyWorld = Math.floor(wy / spacing);
    const izWorld = Math.floor(wz / spacing);

    const ix = ((ixWorld % probesPerAxis) + probesPerAxis) % probesPerAxis;
    const iy = ((iyWorld % probesPerAxis) + probesPerAxis) % probesPerAxis;
    const iz = ((izWorld % probesPerAxis) + probesPerAxis) % probesPerAxis;

    // Flatten 3D index into 1D within the level
    const countX = probesPerAxis;
    const countZ = probesPerAxis;
    const flatIndexInLevel = (iy * countZ + iz) * countX + ix;

    const baseTexel = levelIndex * this.sharedLayoutConfig.probesPerLevel * config.texelsPerProbe;

    // Convert to global texel offset using precomputed baseTexel to avoid mismatches
    const texelIndexStart = baseTexel + flatIndexInLevel * config.texelsPerProbe;

    // Map 1D texels into 2D atlas coords in a single big strip (row-major)
    const rowTexels = config.atlasSize; // full width
    for (let t = 0; t < config.texelsPerProbe; t++) {
      const atlasIdx = texelIndexStart + t;
      const px = atlasIdx % rowTexels;
      const py = Math.floor(atlasIdx / rowTexels);
      if (px < 0 || px >= config.atlasSize || py < 0 || py >= config.atlasSize) continue;
      this.writeTexel(px, py, irr);
      break;
    }

    this.atlas.needsUpdate = true;
  }

  private writeTexel(x: number, y: number, c: Color) {
    const size = this.sharedLayoutConfig.atlasSize;
    const data = this.atlas.image.data as Float32Array;
    const idx = (y * size + x) * 4;
    data[idx + 0] = c.r;
    data[idx + 1] = c.g;
    data[idx + 2] = c.b;
    data[idx + 3] = 1.0;
  }
}
