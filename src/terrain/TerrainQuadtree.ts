import { PerspectiveCamera } from "three";
import { TerrainData, TileCoords } from "./TerrainData";
import { TerrainSampler } from "./TerrainSampler";

export class TerrainQuadtree {
  private visible: TileCoords[] = [];

  constructor(
    private data: TerrainData,
    private sampler: TerrainSampler
  ) {}

  update(camera: PerspectiveCamera): void {
    this.visible.length = 0;

    const cfg = this.data.config;
    const camX = camera.position.x;
    const camZ = camera.position.z;

    // Root is the coarsest LOD (maxLOD). LOD 0 is the most detailed.
    const rootLOD = cfg.maxLOD;

    // Cover an area around the camera in root tiles
    const halfRootTiles = 2; // small window of roots; they are very large
    const baseRoot = this.data.worldToTileCoords(camX, camZ, rootLOD);

    // Distance-based refinement: refine a tile when camera is closer than k * tileSize,
    // using the sampled height at the tile center for accurate 3D distance.
    const shouldRefine = (t: TileCoords): boolean => {
      if (t.lod <= cfg.minLOD) return false; // stop at most detailed allowed (LOD 0)
      const size = cfg.tileSize * Math.pow(2, t.lod);
      const cx = t.tx * size + size * 0.5;
      const cz = t.tz * size + size * 0.5;
      const cy = this.sampler.getHeight(cx, cz).height; // sampled ground height at tile center
      const dx = cx - camX;
      const dy = cy - camera.position.y;
      const dz = cz - camZ;
      const dist = Math.hypot(dx, dy, dz);
      const k = 2.5; // how many tile sizes away we refine
      return dist < size * k;
    };

    const leaves: TileCoords[] = [];
    const refine = (t: TileCoords) => {
      if (shouldRefine(t)) {
        const childLOD = t.lod - 1; // finer
        const cTx = t.tx * 2;
        const cTz = t.tz * 2;

        refine({ tx: cTx + 0, tz: cTz + 0, lod: childLOD });
        refine({ tx: cTx + 1, tz: cTz + 0, lod: childLOD });
        refine({ tx: cTx + 0, tz: cTz + 1, lod: childLOD });
        refine({ tx: cTx + 1, tz: cTz + 1, lod: childLOD });
      } else {
        leaves.push(t);
      }
    };

    // Build roots around camera and refine
    for (let dz = -halfRootTiles; dz <= halfRootTiles; dz++) {
      for (let dx = -halfRootTiles; dx <= halfRootTiles; dx++) {
        refine({ tx: baseRoot.tx + dx, tz: baseRoot.tz + dz, lod: rootLOD });
      }
    }

    // Deduplicate and set visible
    const uniq = new Map<string, TileCoords>();
    for (const t of leaves) {
      const key = `${t.tx}:${t.tz}:${t.lod}`;
      if (!uniq.has(key)) uniq.set(key, t);
    }
    this.visible = Array.from(uniq.values());
  }

  getVisibleTiles(): TileCoords[] {
    return this.visible;
  }
}
