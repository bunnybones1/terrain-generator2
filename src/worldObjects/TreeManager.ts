import {
  Box3,
  BufferGeometry,
  Frustum,
  InstancedMesh,
  InstancedBufferAttribute,
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
import { hash2, rand01 } from "../utils/math";

export interface TreeManagerConfig {
  cellSize: number;
  lodCapacities: number[];
  manageRadius: number;
}

type TreeInstance = {
  pos: Vector3;
  rot: Quaternion;
  scale: number;
  ao: number;
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

    this.manageRadius = Math.ceil(config.manageRadius / this.cellSize);
    this.dropRadius = Math.ceil(this.manageRadius * 1.2);
    this.lodCapacities = config.lodCapacities;

    const maxLodDistance = config.manageRadius / 2;
    this.lodDistances = [];
    for (let i = 0; i < this.lodCapacities.length; i++) {
      this.lodDistances.push(maxLodDistance / Math.pow(2, this.lodCapacities.length - 1 - i));
    }

    this.lodGeoms = buildPineLODGeometries(1, 0.25, this.rng);

    this.material.flatShading = false;
    this.material.needsUpdate = true;

    // Default global cap equals sum of per-LOD capacities; can be raised by changing lodCapacities
    this.globalMaxInstances = this.lodCapacities.reduce((a, b) => a + b, 0);

    this.lodMeshes = this.lodGeoms.slice(0, this.lodCapacities.length).map((g, i) => {
      const mesh = new InstancedMesh(g, this.material, this.lodCapacities[i]);
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(35048);
      mesh.renderOrder = -1;
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

      // Allocate per-instance AO attribute (float), initialized to 0
      const capacity = this.lodCapacities[i];
      const aoArray = new Float32Array(capacity);
      const instanceInvAO = new InstancedBufferAttribute(aoArray, 1);
      instanceInvAO.setUsage(35048); // DynamicDrawUsage
      mesh.geometry.setAttribute("instanceInvAO", instanceInvAO);

      this.scene.add(mesh);
      return mesh;
    });
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
    const minY = Math.min(...ySamples) - 1;
    const maxY = Math.max(...ySamples) + 1;

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

    // Worley-like distribution: fixed feature per 4m cell (at most one tree)
    const worleyCellSize = 4;
    const worldMinX = cx * cs;
    const worldMinZ = cz * cs;
    const worldMaxX = (cx + 1) * cs;
    const worldMaxZ = (cz + 1) * cs;

    // Determine the range of worley cells overlapping this world cell
    const minWx = Math.floor(worldMinX / worleyCellSize);
    const minWz = Math.floor(worldMinZ / worleyCellSize);
    const maxWx = Math.floor((worldMaxX - 1e-6) / worleyCellSize);
    const maxWz = Math.floor((worldMaxZ - 1e-6) / worleyCellSize);

    for (let wz = minWz; wz <= maxWz; wz++) {
      for (let wx = minWx; wx <= maxWx; wx++) {
        const [jx, jz] = hash2(wx, wz); // jx,jz expected in [0,1)
        // Convert Worley cell index to world meters and place feature within the cell with jitter
        const fx = wx * worleyCellSize + (0.5 + (jx - 0.5)) * worleyCellSize; // center + jitter in [-0.5..0.5) * size
        const fz = wz * worleyCellSize + (0.5 + (jz - 0.5)) * worleyCellSize;

        // Only place if the feature falls within this world cell bounds
        if (fx < worldMinX || fx >= worldMaxX || fz < worldMinZ || fz >= worldMaxZ) continue;

        const sample = this.terrain.getSample(fx, fz);
        const y = sample.baseHeight;
        const pineWindow = sample.pineWindow;
        const pine = sample.pine;
        if (pineWindow <= 0 || pine < 1) continue;

        // Orientation with slight tilt
        const yaw = rand01(wx, wz, 14, this.seed) * Math.PI * 2;
        const tiltX = (rand01(wx, wz, 15, this.seed) * 2 - 1) * 0.06;
        const tiltZ = (rand01(wx, wz, 16, this.seed) * 2 - 1) * 0.06;
        const quat = new Quaternion().setFromEuler(tmpEuler.set(tiltX, yaw, tiltZ));

        trees.push({
          pos: new Vector3(fx, y, fz),
          rot: quat,
          scale: pine,
          ao: pineWindow,
        });
      }
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
            meta.minY = Math.min(...ySamples) - 1;
            meta.maxY = Math.max(...ySamples) + 1;
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
      // Sort trees by ascending squared distance to camera in world space
      cell.trees.sort((a, b) => {
        const dax = a.pos.x - camera.position.x;
        const daz = a.pos.z - camera.position.z;
        const dbx = b.pos.x - camera.position.x;
        const dbz = b.pos.z - camera.position.z;
        const da2 = dax * dax + daz * daz;
        const db2 = dbx * dbx + dbz * dbz;
        return da2 - db2;
      });
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

        // Write per-instance AO
        const aoAttr = mesh.geometry.getAttribute("instanceInvAO") as
          | InstancedBufferAttribute
          | undefined;
        if (aoAttr) {
          (aoAttr.array as Float32Array)[mesh.count] = inst.ao ?? 0;
        }

        mesh.count++;
        placed++;
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
