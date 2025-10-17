import {
  Box3,
  BufferGeometry,
  Frustum,
  InstancedMesh,
  Matrix4,
  Matrix4 as TMatrix4,
  MeshStandardMaterial,
  PerspectiveCamera,
  Quaternion,
  Scene,
  Vector3,
  Euler,
} from "three";
import { TerrainSampler } from "../terrain/TerrainSampler";
import { PRNG } from "../utils/PRNG";
import { DirtyAABB } from "../terrain/TerrainData";
import { buildPineLODGeometries } from "./geometry/pine";

export interface TreeManagerConfig {
  cellSize: number;
  density: number;
  baseHeight: number;
  baseRadius: number;
  lodCapacities: number[];
  manageRadius: number;
  jitter?: number;
  minScale?: number;
  maxScale?: number;
}

type TreeInstance = {
  pos: Vector3;
  rot: Quaternion;
  scale: number;
};

type Cell = {
  cx: number;
  cz: number;
  trees: TreeInstance[];
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

export class TreeManager {
  private rng: PRNG;
  private seed: number;

  private cells = new Map<string, Cell>();
  private cellMeta = new Map<string, CellMeta>();

  private lodGeoms: BufferGeometry[] = [];
  private lodMeshes: InstancedMesh[] = [];
  private lodCapacities: number[] = [];
  private lodDistances: number[] = [];
  private globalMaxInstances: number = 0;
  private tmpMatrix = new Matrix4();
  private tmpQuat = new Quaternion();
  private tmpScale = new Vector3();

  private cellSize: number;
  private density: number;
  private jitter: number;
  private minScale: number;
  private maxScale: number;
  private baseHeight: number;
  private baseRadius: number;
  private manageRadius: number;
  private dropRadius: number;

  constructor(
    private name: string,
    private scene: Scene,
    private terrain: TerrainSampler,
    private material: MeshStandardMaterial,
    seed: number,
    config: TreeManagerConfig
  ) {
    this.seed = seed;
    this.rng = new PRNG(seed);

    // Apply configuration
    this.cellSize = config.cellSize;
    this.density = config.density;
    this.baseHeight = config.baseHeight;
    this.baseRadius = config.baseRadius;
    this.jitter = config.jitter ?? 0.95;
    this.minScale = config.minScale ?? 0.7;
    this.maxScale = config.maxScale ?? 1.4;

    this.manageRadius = Math.ceil(config.manageRadius / this.cellSize);
    this.dropRadius = Math.ceil(this.manageRadius * 1.2);
    this.lodCapacities = config.lodCapacities;

    const maxLodDistance = config.manageRadius / 2;
    this.lodDistances = [];
    for (let i = 0; i < this.lodCapacities.length; i++) {
      this.lodDistances.push(maxLodDistance / Math.pow(2, this.lodCapacities.length - 1 - i));
    }

    this.lodGeoms = buildPineLODGeometries(this.baseHeight, this.baseRadius, this.rng);

    this.material.flatShading = false;
    this.material.needsUpdate = true;

    // Default global cap equals sum of per-LOD capacities; can be raised by changing lodCapacities
    this.globalMaxInstances = this.lodCapacities.reduce((a, b) => a + b, 0);

    this.lodMeshes = this.lodGeoms.slice(0, this.lodCapacities.length).map((g, i) => {
      const mesh = new InstancedMesh(g, this.material, this.lodCapacities[i]);
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(35048);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;

      // Large bounds to avoid per-instance culling
      const maxRadiusMeters =
        this.manageRadius * this.cellSize + Math.max(...this.lodDistances) + 20;
      const half = maxRadiusMeters;
      const maxHeight = 2000;
      const minHeight = -2000;
      g.computeBoundingSphere();
      if (g.boundingSphere) {
        g.boundingSphere.center.set(0, 0, 0);
        g.boundingSphere.radius = Math.max(g.boundingSphere.radius, half);
      }
      g.computeBoundingBox();
      if (g.boundingBox) {
        g.boundingBox.min.set(-half, minHeight, -half);
        g.boundingBox.max.set(half, maxHeight, half);
      }

      this.scene.add(mesh);
      return mesh;
    });
  }

  private hash2i(xi: number, zi: number, k: number): number {
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

  private getOrCreateMeta(cx: number, cz: number): CellMeta {
    const k = this.key(cx, cz);
    const existing = this.cellMeta.get(k);
    if (existing) return existing;

    const cs = this.cellSize;
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
    const minY = Math.min(...ySamples) - this.maxScale * this.baseHeight - 1;
    const maxY = Math.max(...ySamples) + this.maxScale * this.baseHeight + 1;

    const meta: CellMeta = {
      cx,
      cz,
      centerX: (cx + 0.5) * cs,
      centerZ: (cz + 0.5) * cs,
      minY,
      maxY,
    };
    this.cellMeta.set(k, meta);
    return meta;
  }

  private buildCell(cx: number, cz: number): Cell {
    const cs = this.cellSize;
    const trees: TreeInstance[] = [];

    const cellArea = cs * cs;
    const expectedPerCell = this.density * cellArea;
    // Convert expectedPerCell to an integer count:
    // - Spawn floor(expectedPerCell) guaranteed
    // - Plus one extra with probability equal to the fractional part
    const base = Math.floor(expectedPerCell);
    const frac = expectedPerCell - base;
    let count = base;
    if (frac > 0 && this.rand01(cx + 17, cz - 23, 0) < frac) count++;
    for (let i = 0; i < count; i++) {
      const rx = (this.rand01(cx, cz, 1 + i * 5) * 2 - 1) * this.jitter;
      const rz = (this.rand01(cx, cz, 2 + i * 5) * 2 - 1) * this.jitter;
      const x = (cx + 0.5 + rx) * cs;
      const z = (cz + 0.5 + rz) * cs;

      const sample = this.terrain.getSample(x, z);
      const y = sample.baseHeight;
      const pineWindow = sample.pineWindow;
      if (pineWindow <= 0) continue;

      // Tree yaw around Y mostly; small tilt X/Z for natural feel
      const yaw = this.rand01(cx, cz, 3 + i * 5) * Math.PI * 2;
      const tiltX = (this.rand01(cx, cz, 4 + i * 5) * 2 - 1) * 0.06;
      const tiltZ = (this.rand01(cx, cz, 5 + i * 5) * 2 - 1) * 0.06;
      const quat = new Quaternion().setFromEuler(tmpEuler.set(tiltX, yaw, tiltZ));

      // Scale influenced by pineWindow; add small per-instance variance
      const variance = this.rand01(cx, cz, 6 + i * 5) * 0.2 - 0.1; // -0.1..0.1
      const s01 = Math.min(1, Math.max(0, pineWindow + variance));
      const scale = this.minScale + (this.maxScale - this.minScale) * s01;

      trees.push({
        pos: new Vector3(x, y, z),
        rot: quat,
        scale,
      });
    }

    return { cx, cz, trees };
  }

  private getCameraFrustum(camera: PerspectiveCamera): Frustum {
    const projView = new TMatrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    );
    return new Frustum().setFromProjectionMatrix(projView);
  }

  private cellIntersectsFrustum(cx: number, cz: number, frustum: Frustum): boolean {
    const cs = this.cellSize;
    const minX = cx * cs;
    const minZ = cz * cs;
    const maxX = (cx + 1) * cs;
    const maxZ = (cz + 1) * cs;

    const meta = this.getOrCreateMeta(cx, cz);
    const aabb = new Box3(new Vector3(minX, meta.minY, minZ), new Vector3(maxX, meta.maxY, maxZ));
    return frustum.intersectsBox(aabb);
  }

  private ensureCellsAround(camera: PerspectiveCamera) {
    const cs = this.cellSize;
    const ccx = Math.floor(camera.position.x / cs);
    const ccz = Math.floor(camera.position.z / cs);
    const frustum = this.getCameraFrustum(camera);
    const nearKeepDistanceMeters = 30;
    const nearKeepDist2 = nearKeepDistanceMeters * nearKeepDistanceMeters;

    for (let dz = -this.manageRadius; dz <= this.manageRadius; dz++) {
      for (let dx = -this.manageRadius; dx <= this.manageRadius; dx++) {
        const cx = ccx + dx;
        const cz = ccz + dz;
        const k = this.key(cx, cz);
        if (!this.cells.has(k)) {
          const meta = this.getOrCreateMeta(cx, cz);

          const dxw = meta.centerX - camera.position.x;
          const dzw = meta.centerZ - camera.position.z;
          const dist2 = dxw * dxw + dzw * dzw;
          const nearCamera = dist2 <= nearKeepDist2;

          if (nearCamera || this.cellIntersectsFrustum(cx, cz, frustum)) {
            const cell = this.buildCell(cx, cz);
            this.cells.set(k, cell);
          }
        }
      }
    }

    for (const [k, cell] of this.cells) {
      const distCx = cell.cx - ccx;
      const distCz = cell.cz - ccz;
      const outsideRadius = Math.max(Math.abs(distCx), Math.abs(distCz)) > this.dropRadius;

      const centerX = (cell.cx + 0.5) * cs;
      const centerZ = (cell.cz + 0.5) * cs;
      const dxw = centerX - camera.position.x;
      const dzw = centerZ - camera.position.z;
      const dist2 = dxw * dxw + dzw * dzw;
      const nearCamera = dist2 <= nearKeepDist2;

      const outsideFrustum = !nearCamera && !this.cellIntersectsFrustum(cell.cx, cell.cz, frustum);

      if ((outsideRadius || outsideFrustum) && !nearCamera) {
        this.cells.delete(k);
      }
    }
  }

  update(camera: PerspectiveCamera, dirtyAABBs?: DirtyAABB[]) {
    this.ensureCellsAround(camera);

    if (dirtyAABBs && dirtyAABBs.length > 0) {
      const cs = this.cellSize;
      const eps = 0.5;

      for (const raw of dirtyAABBs) {
        const aabb = {
          minX: raw.minX - eps,
          minZ: raw.minZ - eps,
          maxX: raw.maxX + eps,
          maxZ: raw.maxZ + eps,
        };

        const minCx = Math.floor(aabb.minX / cs);
        const maxCx = Math.floor(aabb.maxX / cs);
        const minCz = Math.floor(aabb.minZ / cs);
        const maxCz = Math.floor(aabb.maxZ / cs);

        for (let cz = minCz; cz <= maxCz; cz++) {
          for (let cx = minCx; cx <= maxCx; cx++) {
            const k = this.key(cx, cz);
            const cell = this.cells.get(k);
            if (!cell) continue;

            for (const inst of cell.trees) {
              const x = inst.pos.x;
              const z = inst.pos.z;
              const sample = this.terrain.getSample(x, z);
              inst.pos.y = sample.baseHeight;
            }

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
            meta.minY = Math.min(...ySamples) - this.maxScale * this.baseHeight - 1;
            meta.maxY = Math.max(...ySamples) + this.maxScale * this.baseHeight + 1;
          }
        }
      }
    }

    this.lodMeshes.forEach((m) => (m.count = 0));

    const thresholds = this.lodDistances;
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

    let placed = 0;
    let saturatedLogged = false;

    for (const cell of sortedCells) {
      for (const inst of cell.trees) {
        if (this.globalMaxInstances > 0 && placed >= this.globalMaxInstances) {
          if (!saturatedLogged) {
            console.debug(`[${this.name}] global instance cap reached:`, this.globalMaxInstances);
            saturatedLogged = true;
          }
          break;
        }

        const dist = inst.pos.distanceTo(camera.position);
        let bucket = thresholds.length;
        for (let i = 0; i < thresholds.length; i++) {
          if (dist < thresholds[i]) {
            bucket = i;
            break;
          }
        }
        if (bucket >= this.lodMeshes.length) bucket = this.lodMeshes.length - 1;

        // Try preferred bucket; if full, spill to coarser LODs; if all full, skip
        let targetBucket = bucket;
        while (
          targetBucket < this.lodMeshes.length &&
          this.lodMeshes[targetBucket].count >= this.lodCapacities[targetBucket]
        ) {
          targetBucket++;
        }

        if (targetBucket >= this.lodMeshes.length) {
          // All finer-to-coarser are full; try last coarsest explicitly
          targetBucket = this.lodMeshes.length - 1;
          if (this.lodMeshes[targetBucket].count >= this.lodCapacities[targetBucket]) {
            if (!saturatedLogged) {
              console.debug(
                `[${this.name}] LOD capacities saturated; increase lodCapacities to see higher density.`
              );
              saturatedLogged = true;
            }
            continue;
          }
        }

        const mesh = this.lodMeshes[targetBucket];
        this.tmpQuat.copy(inst.rot);
        this.tmpScale.set(inst.scale, inst.scale, inst.scale);
        this.tmpMatrix.compose(inst.pos, this.tmpQuat, this.tmpScale);
        mesh.setMatrixAt(mesh.count, this.tmpMatrix);
        mesh.count++;
        placed++;
      }
    }

    for (const mesh of this.lodMeshes) {
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
