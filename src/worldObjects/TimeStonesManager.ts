import {
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Scene,
  Vector3,
  PerspectiveCamera,
  Euler,
  InstancedBufferAttribute,
  ShaderMaterial,
  BufferGeometry,
} from "three";
import { TerrainSampler } from "../terrain/TerrainSampler";
import { PRNG } from "../utils/PRNG";
import { DirtyAABB } from "../terrain/TerrainData";
import { packKey16 } from "../helpers/key16";
import { buildTimeStoneLODGeometries } from "./geometry/timeStone";
import { timeBoost, worldTime } from "../sharedGameData";

export interface StonesManagerConfig {
  cellSize: number;
  density: number;
  stoneRadius: number;
  lodCapacities: number[];
  manageRadius: number;
  jitter?: number;
}

type StoneInstance = {
  pos: Vector3;
  rot: Quaternion;
  scale: number;
  ao: number;
};

type Cell = {
  cx: number;
  cz: number;
  stones: StoneInstance[];
};

type CellMeta = {
  cx: number;
  cz: number;
  centerX: number;
  centerZ: number;
  minY: number;
  maxY: number;
};

const tmpEuler = new Euler();
const tmpEuler2 = new Euler(0, 0, 0, "XZY");

const STONE_ON_GROUND_OFFSET = 12;
export class TimeStonesManager {
  private rng: PRNG;
  // Virtualization parameters
  private seed: number;

  // Spatial cell cache
  private cells = new Map<string, Cell>();
  // Metadata cache for cells (coordinates and height AABB), built proactively
  // Use packed 16-bit per axis numeric key for performance
  private cellMetaNum = new Map<number, CellMeta>();

  // LOD buckets
  private lodGeoms: BufferGeometry[] = [];
  private lodMeshes: InstancedMesh[] = [];
  private lodCapacities: number[] = [];
  private lodDistances: number[] = [];
  private tmpMatrix = new Matrix4();
  private tmpQuat = new Quaternion();
  private tmpScale = new Vector3();
  private tmpPos = new Vector3();

  private cellSize: number;
  private density: number;
  private minScale = 0.7;
  private maxScale = 1.5;
  private stoneRadius: number;
  private manageRadius: number;
  private dropRadius: number;

  constructor(
    private name: string,
    private scene: Scene,
    private terrain: TerrainSampler,
    private material: MeshStandardMaterial,
    private depthMaterial: ShaderMaterial,
    seed: number,
    config: StonesManagerConfig
  ) {
    this.seed = seed;
    this.rng = new PRNG(seed);

    // Apply configuration
    this.cellSize = config.cellSize;
    this.density = config.density;
    this.stoneRadius = config.stoneRadius;

    // Convert meters to cells for internal use
    this.manageRadius = Math.ceil(config.manageRadius / this.cellSize);
    this.dropRadius = Math.ceil(this.manageRadius * 1.2);
    this.lodCapacities = config.lodCapacities;

    // Derive LOD distances from manageRadius (in meters)
    // Highest LOD distance is half the manageRadius
    // Each smaller LOD distance is half the one above it
    const maxLodDistance = config.manageRadius / 2;
    this.lodDistances = [];
    for (let i = 0; i < this.lodCapacities.length; i++) {
      this.lodDistances.push(maxLodDistance / Math.pow(2, this.lodCapacities.length - 1 - i));
    }

    this.lodGeoms = buildTimeStoneLODGeometries(this.stoneRadius, this.rng);

    // Ensure material has smooth shading
    this.material.flatShading = false;
    this.material.needsUpdate = true;

    this.lodMeshes = this.lodGeoms.slice(0, this.lodCapacities.length).map((g, i) => {
      const mesh = new InstancedMesh(g, this.material, this.lodCapacities[i]);
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(35048); // DynamicDrawUsage
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.customDepthMaterial = depthMaterial;

      // Disable renderer frustum culling for this instanced mesh
      mesh.frustumCulled = false;

      // Expand geometry bounds to safely include the entire management area around the camera.
      // Using manageRadius in cells converted to world meters.
      const maxRadiusMeters =
        this.manageRadius * this.cellSize + Math.max(...this.lodDistances) + 20;
      const half = maxRadiusMeters;
      const maxHeight = 2000; // generous vertical bound
      const minHeight = -2000;

      // Ensure bounding sphere exists and is large enough
      mesh.geometry.computeBoundingSphere();
      if (mesh.geometry.boundingSphere) {
        mesh.geometry.boundingSphere.center.set(0, 0, 0);
        mesh.geometry.boundingSphere.radius = Math.max(mesh.geometry.boundingSphere.radius, half);
      }

      // Set an expansive bounding box as well
      mesh.geometry.computeBoundingBox();
      if (mesh.geometry.boundingBox) {
        mesh.geometry.boundingBox.min.set(-half, minHeight, -half);
        mesh.geometry.boundingBox.max.set(half, maxHeight, half);
      }

      // Allocate per-instance inverse AO attribute (float)
      const capacity = this.lodCapacities[i];
      const aoArray = new Float32Array(capacity);
      const instanceInvAO = new InstancedBufferAttribute(aoArray, 1);
      instanceInvAO.setUsage(35048); // DynamicDrawUsage
      mesh.geometry.setAttribute("instanceInvAO", instanceInvAO);

      this.scene.add(mesh);
      return mesh;
    });
  }

  // Hash utility to get deterministic pseudo-random numbers from integer cell coords
  private hash2i(xi: number, zi: number, k: number): number {
    // Robert Jenkins' 32 bit integer hash variant mixed with seed and stream k
    let h = xi * 374761393 + zi * 668265263 + (this.seed ^ (k * 1274126177));
    h = (h ^ (h >>> 13)) | 0;
    h = Math.imul(h, 1274126177);
    h = (h ^ (h >>> 16)) >>> 0;
    return h;
  }
  private rand01(xi: number, zi: number, k: number): number {
    return this.hash2i(xi, zi, k) / 4294967295;
  }

  private key(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }

  // Find a local peak: pre-sample highest-of-100 in the cell, then ascend via normals until peak or limit
  private ascendToLocalPeak(
    x0: number,
    z0: number,
    maxIter = 32,
    step = 1.0
  ): { x: number; z: number; y: number } {
    // Determine cell bounds from x0,z0 and cellSize
    const cs = this.cellSize;
    const cx = Math.floor(x0 / cs);
    const cz = Math.floor(z0 / cs);
    const minX = cx * cs;
    const minZ = cz * cs;
    const maxX = (cx + 1) * cs;
    const maxZ = (cz + 1) * cs;

    // Pre-sample 100 random points in the cell and pick the highest
    let bestX = x0;
    let bestZ = z0;
    let bestY = this.terrain.getSample(bestX, bestZ).baseHeight;

    // Use deterministic PRNG seeded by cell for stable placement
    const baseSeedX = cx * 73856093;
    const baseSeedZ = cz * 19349663;
    for (let i = 0; i < 100; i++) {
      // Hash-based deterministic random within [0,1)
      const r1 = this.rand01(baseSeedX + i, baseSeedZ - i, 101);
      const r2 = this.rand01(baseSeedX - i * 2, baseSeedZ + i * 3, 202);
      const sx = minX + r1 * (maxX - minX);
      const sz = minZ + r2 * (maxZ - minZ);
      const sy = this.terrain.getSample(sx, sz).baseHeight;
      if (sy > bestY) {
        bestY = sy;
        bestX = sx;
        bestZ = sz;
      }
    }

    // Start ascent from the best candidate
    let x = bestX;
    let z = bestZ;
    let sample = this.terrain.getSample(x, z);
    let sampleNormal = this.terrain.getNormal(x, z);
    let y = sample.baseHeight;

    for (let i = 0; i < maxIter; i++) {
      // Terrain normal points "up"; uphill horizontal direction is opposite to normal's horizontal projection
      const nx = sampleNormal[0];
      const nz = sampleNormal[2];
      const dirX = -nx;
      const dirZ = -nz;

      // If normal is near-vertical (flat) or horizontal component vanishes, break
      const len = Math.hypot(dirX, dirZ);
      if (len < 1e-4) break;

      const ux = dirX / len;
      const uz = dirZ / len;

      // Probe a small step ahead
      const xNext = x + ux * step;
      const zNext = z + uz * step;

      // If the next step exits the local cell, cancel by returning invalid result
      if (xNext < minX || xNext > maxX || zNext < minZ || zNext > maxZ) {
        return { x, z, y: -Infinity };
      }

      const sNext = this.terrain.getSample(xNext, zNext);
      const snNext = this.terrain.getNormal(xNext, zNext);

      // If next is not higher, try halving the step to refine; if no improvement, stop
      if (sNext.baseHeight <= y + 1e-5) {
        step *= 0.5;
        if (step < 0.05) break;
        continue;
      }

      // Accept the move
      x = xNext;
      z = zNext;
      sample = sNext;
      sampleNormal = snNext;
      y = sample.baseHeight;
    }

    return { x, z, y };
  }

  private getOrCreateMeta(cx: number, cz: number): CellMeta {
    const k = packKey16(cx, cz);
    const existing = this.cellMetaNum.get(k);
    if (existing) return existing;

    const cs = this.cellSize;
    const minX = cx * cs;
    const minZ = cz * cs;
    const maxX = (cx + 1) * cs;
    const maxZ = (cz + 1) * cs;

    // Sample terrain heights at corners and center once
    const ySamples = [
      this.terrain.getSample(minX, minZ).baseHeight,
      this.terrain.getSample(maxX, minZ).baseHeight,
      this.terrain.getSample(minX, maxZ).baseHeight,
      this.terrain.getSample(maxX, maxZ).baseHeight,
      this.terrain.getSample((minX + maxX) * 0.5, (minZ + maxZ) * 0.5).baseHeight,
    ];
    const minY = Math.min(...ySamples) - this.maxScale - 1;
    const maxY = Math.max(...ySamples) + this.maxScale + 1;

    const meta: CellMeta = {
      cx,
      cz,
      centerX: (cx + 0.5) * cs,
      centerZ: (cz + 0.5) * cs,
      minY,
      maxY,
    };
    this.cellMetaNum.set(k, meta);
    return meta;
  }

  private buildCell(cx: number, cz: number): Cell {
    const cs = this.cellSize;
    const stones: StoneInstance[] = [];

    let x = (cx + 0.5) * cs;
    let z = (cz + 0.5) * cs;

    // Climb toward a local maximum using terrain normals
    const peak = this.ascendToLocalPeak(x, z, 32, Math.max(0.5, cs * 0.1));
    // If ascent exited the cell (invalid), discard this candidate
    if (!isFinite(peak.y) || peak.y === -Infinity) {
      return { cx, cz, stones };
    }
    x = peak.x;
    z = peak.z;

    const sampleAt = this.terrain.getSample(x, z);
    const y = sampleAt.baseHeight;
    if (y < 0) return { cx, cz, stones };

    // Generate full random rotation using three independent random angles
    // const rotX = this.rand01(cx, cz, 3 + i * 5) * Math.PI * 2;
    const rotX = 0;
    // const rotY = 0;
    const rotY = this.rand01(cx, cz, 4) * Math.PI * 2;
    const rotZ = 0;
    // const rotZ = this.rand01(cx, cz, 5 + i * 5) * Math.PI * 2;
    const quat = new Quaternion().setFromEuler(tmpEuler.set(rotX, rotY, rotZ));

    const s01 = this.rand01(cx, cz, 6);
    const scale = this.minScale + (this.maxScale - this.minScale) * s01;

    const pine = sampleAt.pineWindow;

    if (pine > 0.2) return { cx, cz, stones };

    stones.push({
      pos: new Vector3(x, y + STONE_ON_GROUND_OFFSET, z),
      rot: quat,
      scale,
      ao: sampleAt.pineWindow,
    });

    return { cx, cz, stones };
  }

  private ensureCellsAround(camera: PerspectiveCamera) {
    const cs = this.cellSize;
    const ccx = Math.floor(camera.position.x / cs);
    const ccz = Math.floor(camera.position.z / cs);
    const nearKeepDistanceMeters = 40;
    const nearKeepDist2 = nearKeepDistanceMeters * nearKeepDistanceMeters;

    // Create needed cells within manageRadius that intersect frustum (by AABB) or are near camera
    for (let dz = -this.manageRadius; dz <= this.manageRadius; dz++) {
      for (let dx = -this.manageRadius; dx <= this.manageRadius; dx++) {
        const cx = ccx + dx;
        const cz = ccz + dz;
        const k = this.key(cx, cz);
        if (!this.cells.has(k)) {
          const cell = this.buildCell(cx, cz);
          this.cells.set(k, cell);
        }
      }
    }

    // Evict cells beyond dropRadius or whose AABB does not intersect frustum, but never drop near-camera cells
    for (const [k, cell] of this.cells) {
      const distCx = cell.cx - ccx;
      const distCz = cell.cz - ccz;
      const outsideRadius = Math.max(Math.abs(distCx), Math.abs(distCz)) > this.dropRadius;

      // Near-keep check using cell center distance
      const centerX = (cell.cx + 0.5) * cs;
      const centerZ = (cell.cz + 0.5) * cs;
      const dxw = centerX - camera.position.x;
      const dzw = centerZ - camera.position.z;
      const dist2 = dxw * dxw + dzw * dzw;
      const nearCamera = dist2 <= nearKeepDist2;

      if (outsideRadius && !nearCamera) {
        this.cells.delete(k);
      }
    }
  }

  // Fill meshes based on cached cells around camera each frame
  update(camera: PerspectiveCamera, dirtyAABBs?: DirtyAABB[]) {
    // Maintain cell cache around camera
    this.ensureCellsAround(camera);

    // If there are dirty AABBs, update stones in any cells that overlap with the AABBs
    if (dirtyAABBs && dirtyAABBs.length > 0) {
      const cs = this.cellSize;
      const eps = 0.5; // expand bounds to catch edge stones and FP issues

      for (const raw of dirtyAABBs) {
        const aabb = {
          minX: raw.minX - eps,
          minZ: raw.minZ - eps,
          maxX: raw.maxX + eps,
          maxZ: raw.maxZ + eps,
        };

        // Determine overlapped cell range using expanded bounds
        const minCx = Math.floor(aabb.minX / cs);
        const maxCx = Math.floor(aabb.maxX / cs);
        const minCz = Math.floor(aabb.minZ / cs);
        const maxCz = Math.floor(aabb.maxZ / cs);

        for (let cz = minCz; cz <= maxCz; cz++) {
          for (let cx = minCx; cx <= maxCx; cx++) {
            const k = this.key(cx, cz);
            const cell = this.cells.get(k);
            if (!cell) continue;

            // Robust: update all stones in overlapped cells (fast and safe),
            // alternatively keep an inclusion test with tolerance if desired.
            for (const inst of cell.stones) {
              const x = inst.pos.x;
              const z = inst.pos.z;
              // If you wish to restrict to AABB, keep this tolerant check:
              // if (x < aabb.minX || x > aabb.maxX || z < aabb.minZ || z > aabb.maxZ) continue;

              const sample = this.terrain.getSample(x, z);
              inst.pos.y = sample.baseHeight + STONE_ON_GROUND_OFFSET;
              inst.ao = sample.pineWindow;
            }

            // Recompute cell meta min/max Y from fresh terrain samples to keep culling correct
            // Sample terrain at corners and center to rebuild conservative vertical bounds
            const minX = cx * cs;
            const minZ = cz * cs;
            const maxX = (cx + 1) * cs;
            const maxZ = (cz + 1) * cs;
            const ySamples = [
              this.terrain.getSample(minX, minZ).baseHeight,
              this.terrain.getSample(maxX, minZ).baseHeight,
              this.terrain.getSample(minX, maxZ).baseHeight,
              this.terrain.getSample(maxX, maxZ).baseHeight,
              this.terrain.getSample((minX + maxX) * 0.5, (minZ + maxZ) * 0.5).baseHeight,
            ];
            const meta = this.getOrCreateMeta(cx, cz);
            meta.minY = Math.min(...ySamples) - this.maxScale - 1;
            meta.maxY = Math.max(...ySamples) + this.maxScale + 1;
          }
        }
      }
    }

    // Reset counts
    this.lodMeshes.forEach((m) => (m.count = 0));

    // Iterate all stones in cache and assign to LOD bucket
    const thresholds = this.lodDistances;

    // Optional global cap
    const globalMax = 0;
    let globalCount = 0;

    // Collect and sort cells by distance from camera (closest first)
    const sortedCells = Array.from(this.cells.values());
    sortedCells.sort((a, b) => {
      const cs = this.cellSize;
      const ax = (a.cx + 0.5) * cs - camera.position.x;
      const az = (a.cz + 0.5) * cs - camera.position.z;
      const bx = (b.cx + 0.5) * cs - camera.position.x;
      const bz = (b.cz + 0.5) * cs - camera.position.z;
      const da2 = ax * ax + az * az;
      const db2 = bx * bx + bz * bz;
      return da2 - db2;
    });

    for (const cell of sortedCells) {
      for (const inst of cell.stones) {
        if (globalMax > 0 && globalCount >= globalMax) break;

        const dist = inst.pos.distanceTo(camera.position);
        let bucket = thresholds.length; // default to coarsest
        for (let i = 0; i < thresholds.length; i++) {
          if (dist < thresholds[i]) {
            bucket = i;
            break;
          }
        }
        if (bucket >= this.lodMeshes.length) bucket = this.lodMeshes.length - 1;

        // Try preferred bucket; spill to coarser if full
        let targetBucket = bucket;
        while (
          targetBucket < this.lodMeshes.length &&
          this.lodMeshes[targetBucket].count >= this.lodCapacities[targetBucket]
        ) {
          targetBucket++;
        }
        if (targetBucket >= this.lodMeshes.length) {
          continue;
        }

        const mesh = this.lodMeshes[targetBucket];
        this.tmpScale.set(inst.scale, inst.scale, inst.scale);
        this.tmpPos.copy(inst.pos);
        this.tmpPos.y += Math.sin(worldTime.value * 50.0);

        // Compute camera distance and a proximity factor (0 far -> 1 very close within 10m)
        const dx = camera.position.x - this.tmpPos.x;
        const dy = (camera.position.y - this.tmpPos.y) * 0.2;
        const dz = camera.position.z - this.tmpPos.z;
        const distToCam = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const proximity = Math.max(0, 1 - distToCam / 10); // within 10 meters -> >0

        this.tmpQuat.copy(inst.rot);
        tmpEuler2.setFromQuaternion(this.tmpQuat);
        if (proximity > 0) {
          timeBoost.value += proximity * 0.01;
        }
        tmpEuler2.y += worldTime.value * 100.1;
        tmpEuler2.x += Math.sin(worldTime.value * 200.1) * 0.04;
        tmpEuler2.z += Math.cos(worldTime.value * 300.1) * 0.04;
        this.tmpQuat.setFromEuler(tmpEuler2);

        this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
        mesh.setMatrixAt(mesh.count, this.tmpMatrix);

        // Set per-instance inverse AO value; reuse to carry proximity (or keep AO if preferred)
        const aoAttr = mesh.geometry.getAttribute("instanceInvAO") as
          | InstancedBufferAttribute
          | undefined;
        if (aoAttr) {
          // Pack proximity for potential shader use; fallback to original ao if you need it instead
          (aoAttr.array as Float32Array)[mesh.count] = proximity;
        }

        mesh.count++;
        globalCount++;
      }
    }

    for (const mesh of this.lodMeshes) {
      mesh.instanceMatrix.needsUpdate = true;
      const aoAttr = mesh.geometry.getAttribute("instanceInvAO") as
        | InstancedBufferAttribute
        | undefined;
      if (aoAttr) aoAttr.needsUpdate = true;
    }
  }
}
