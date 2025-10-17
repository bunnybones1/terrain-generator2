import {
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Scene,
  Vector3,
  Frustum,
  Matrix4 as TMatrix4,
  Box3,
  PerspectiveCamera,
  IcosahedronGeometry,
} from "three";
import { TerrainSampler } from "../terrain/TerrainSampler";
import { PRNG } from "../utils/PRNG";
import { buildStoneLODGeometries } from "./geometry/stone";

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
  rotY: number;
  scale: number;
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

export class StonesManager {
  private rng: PRNG;
  // Virtualization parameters
  private seed: number;

  // Spatial cell cache
  private cells = new Map<string, Cell>();
  // Metadata cache for cells (coordinates and height AABB), built proactively
  private cellMeta = new Map<string, CellMeta>();
  // Track which ring of cells around camera we've prebuilt meta for
  private metaBuiltRadius = 0;

  // LOD buckets
  private lodGeoms: IcosahedronGeometry[] = [];
  private lodMeshes: InstancedMesh[] = [];
  private lodCapacities: number[] = [];
  private lodDistances: number[] = [];
  private tmpMatrix = new Matrix4();
  private tmpQuat = new Quaternion();
  private tmpScale = new Vector3();
  private tmpPos = new Vector3();

  private cellSize: number;
  private density: number;
  private jitter: number;
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
    seed: number,
    config: StonesManagerConfig
  ) {
    this.seed = seed;
    this.rng = new PRNG(seed);

    // Apply configuration
    this.cellSize = config.cellSize;
    this.density = config.density;
    this.stoneRadius = config.stoneRadius;
    this.jitter = config.jitter ?? 0.9;

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

    this.lodGeoms = buildStoneLODGeometries(this.stoneRadius, this.rng);

    // Ensure material has smooth shading
    this.material.flatShading = false;
    this.material.needsUpdate = true;

    this.lodMeshes = this.lodGeoms.slice(0, this.lodCapacities.length).map((g, i) => {
      const mesh = new InstancedMesh(g, this.material, this.lodCapacities[i]);
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(35048); // DynamicDrawUsage
      mesh.castShadow = true;
      mesh.receiveShadow = true;

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

  private getOrCreateMeta(cx: number, cz: number): CellMeta {
    const k = this.key(cx, cz);
    const existing = this.cellMeta.get(k);
    if (existing) return existing;

    const cs = this.cellSize;
    const minX = cx * cs;
    const minZ = cz * cs;
    const maxX = (cx + 1) * cs;
    const maxZ = (cz + 1) * cs;

    // Sample terrain heights at corners and center once
    const ySamples = [
      this.terrain.getHeight(minX, minZ).height,
      this.terrain.getHeight(maxX, minZ).height,
      this.terrain.getHeight(minX, maxZ).height,
      this.terrain.getHeight(maxX, maxZ).height,
      this.terrain.getHeight((minX + maxX) * 0.5, (minZ + maxZ) * 0.5).height,
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
    this.cellMeta.set(k, meta);
    return meta;
  }

  private buildCell(cx: number, cz: number): Cell {
    const cs = this.cellSize;
    const stones: StoneInstance[] = [];

    // Expected count per cell from density
    const cellArea = cs * cs;
    const expectedPerCell = this.density * cellArea;
    const maxTrials = 5;
    let count = 0;
    let acc = expectedPerCell;
    for (let t = 0; t < maxTrials; t++) {
      const p = Math.min(1, acc);
      if (this.rand01(cx + t * 17, cz - t * 23, 0) < p) count++;
      acc -= 1;
      if (acc <= 0) break;
    }

    for (let i = 0; i < count; i++) {
      const rx = (this.rand01(cx, cz, 1 + i * 3) * 2 - 1) * this.jitter;
      const rz = (this.rand01(cx, cz, 2 + i * 3) * 2 - 1) * this.jitter;
      const x = (cx + 0.5 + rx) * cs;
      const z = (cz + 0.5 + rz) * cs;

      const y = this.terrain.getHeight(x, z).baseHeight;
      const slope = this.terrain.getSlope(x, z);
      if (y > 0 && slope < 0.5) continue;

      const rotY = this.rand01(cx, cz, 3 + i * 3) * Math.PI * 2;
      const s01 = this.rand01(cx, cz, 4 + i * 3);
      const scale = this.minScale + (this.maxScale - this.minScale) * s01;

      stones.push({ pos: new Vector3(x, y - 0.25, z), rotY, scale });
    }

    return { cx, cz, stones };
  }

  // Build a frustum from a camera
  private getCameraFrustum(camera: PerspectiveCamera): Frustum {
    const projView = new TMatrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    );
    return new Frustum().setFromProjectionMatrix(projView);
    // Note: three.js Frustum.setFromProjectionMatrix uses clip-space planes from projView
  }

  // Test if a cell's AABB intersects the frustum
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
    const nearKeepDistanceMeters = 40;
    const nearKeepDist2 = nearKeepDistanceMeters * nearKeepDistanceMeters;

    // Create needed cells within manageRadius that intersect frustum (by AABB) or are near camera
    for (let dz = -this.manageRadius; dz <= this.manageRadius; dz++) {
      for (let dx = -this.manageRadius; dx <= this.manageRadius; dx++) {
        const cx = ccx + dx;
        const cz = ccz + dz;
        const k = this.key(cx, cz);
        if (!this.cells.has(k)) {
          const meta = this.getOrCreateMeta(cx, cz);

          // Near-keep based on distance to the cell center using cached meta
          const dxw = meta.centerX - camera.position.x;
          const dzw = meta.centerZ - camera.position.z;
          const dist2 = dxw * dxw + dzw * dzw;
          const nearCamera = dist2 <= nearKeepDist2;

          // Frustum test considers full cell AABB via cellIntersectsFrustum
          if (nearCamera || this.cellIntersectsFrustum(cx, cz, frustum)) {
            const cell = this.buildCell(cx, cz);
            this.cells.set(k, cell);
          }
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

      // AABB-based frustum intersection
      const outsideFrustum = !nearCamera && !this.cellIntersectsFrustum(cell.cx, cell.cz, frustum);

      if ((outsideRadius || outsideFrustum) && !nearCamera) {
        this.cells.delete(k);
      }
    }
  }

  // Fill meshes based on cached cells around camera each frame
  update(camera: PerspectiveCamera) {
    this.ensureCellsAround(camera);

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
        this.tmpQuat.setFromAxisAngle(new Vector3(0, 1, 0), inst.rotY);
        this.tmpScale.set(inst.scale, inst.scale, inst.scale);
        this.tmpMatrix.compose(inst.pos, this.tmpQuat, this.tmpScale);
        mesh.setMatrixAt(mesh.count, this.tmpMatrix);
        mesh.count++;
        globalCount++;
      }
    }

    for (const mesh of this.lodMeshes) {
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
