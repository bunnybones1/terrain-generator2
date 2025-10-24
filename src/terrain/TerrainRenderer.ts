import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Camera,
  Mesh,
  MeshStandardMaterial,
  Scene,
  ShaderMaterial,
  Vector3,
} from "three";
import { TerrainData, TileCoords } from "./TerrainData";
import GrassSystem from "../GrassSystem";

const maxTilesPerFrame = 40;
type TileEntry = {
  mesh: Mesh;
  key: string;
};

export class TerrainRenderer {
  public tiles = new Map<string, TileEntry>();

  constructor(
    private data: TerrainData,
    private scene: Scene,
    private material: MeshStandardMaterial,
    private depthMaterial: ShaderMaterial,
    private grassSystem: GrassSystem
  ) {}

  updateAndRender(camera: Camera, visibleTiles: TileCoords[]): void {
    let tileCount = 0;
    const keep = new Set<string>();
    visibleTiles.sort((a, b) => a.lod - b.lod);
    for (const t of visibleTiles) {
      const key = `${t.tx}:${t.tz}:${t.lod}`;
      keep.add(key);
      if (!this.tiles.has(key)) {
        const mesh = this.buildTile(t);
        this.scene.add(mesh);
        this.tiles.set(key, { mesh, key });
        tileCount++;
      }
      if (tileCount > maxTilesPerFrame) {
        break;
      }
    }
    // Remove tiles no longer visible
    for (const [key, entry] of this.tiles) {
      if (!keep.has(key)) {
        this.scene.remove(entry.mesh);
        entry.mesh.geometry.dispose();
        // (entry.mesh.material as Material).dispose();
        this.tiles.delete(key);
      }
    }

    // Rebuild tiles marked dirty due to terrain edits
    const dirty = this.data.popDirtyTiles();
    for (const key of dirty) {
      const entry = this.tiles.get(key);
      if (entry) {
        const [tx, tz, lod] = key.split(":").map((v) => parseInt(v, 10));
        this.rebuildTile({ tx, tz, lod });
      }
    }
  }

  private rebuildTile(t: TileCoords) {
    const key = `${t.tx}:${t.tz}:${t.lod}`;
    const entry = this.tiles.get(key);
    if (!entry) return;
    // remove old mesh
    this.scene.remove(entry.mesh);
    entry.mesh.geometry.dispose();
    // build and add new
    const mesh = this.buildTile(t);
    this.scene.add(mesh);
    this.tiles.set(key, { mesh, key });
  }

  private buildTile(t: TileCoords): Mesh {
    const { x, z, size } = this.data.tileWorldOrigin(t);
    const res = this.data.config.tileResolution;
    const geo = new BufferGeometry();
    // Build grid positions and uvs
    const verts: number[] = [];
    const uvs: number[] = [];
    const pines: number[] = [];
    const invAOAndMask: number[] = []; // x: invAO (1 is dark, 0 is bright), y: mask (always 0 for terrain)
    const indices: number[] = [];
    const useBaseForHighLod = t.lod < 1;
    // const useBaseForHighLod = false;
    const half = size * 0.5;
    const cx = x + half;
    const cz = z + half;

    let low = Infinity;
    let high = -Infinity;

    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const fx = i / (res - 1);
        const fz = j / (res - 1);
        // World coordinates for sampling
        const wx = x + fx * size;
        const wz = z + fz * size;
        const terrainSample = this.data.getSample(wx, wz);
        const wy = useBaseForHighLod ? terrainSample.baseHeight : terrainSample.height;

        low = Math.min(low, wy);
        high = Math.max(high, wy);
        // Tile-local, centered XZ
        const lx = fx * size - half;
        const lz = fz * size - half;
        verts.push(lx, wy, lz);
        pines.push(useBaseForHighLod ? 0 : terrainSample.pine);
        // x: invAO from pineWindow (or 0 at high LOD), y: mask=0
        invAOAndMask.push(useBaseForHighLod ? terrainSample.pineWindow : 0, 0);
        // World-space UVs: 1.0 UV = 4 meters in world space
        uvs.push(wx / 4.0, wz / 4.0);
      }
    }
    const idx = (i: number, j: number) => j * res + i;
    for (let j = 0; j < res - 1; j++) {
      for (let i = 0; i < res - 1; i++) {
        const a = idx(i, j);
        const b = idx(i + 1, j);
        const c = idx(i, j + 1);
        const d = idx(i + 1, j + 1);
        indices.push(a, c, b, b, c, d);
      }
    }

    // First, assign base attributes and compute normals for the base grid only
    geo.setAttribute("position", new BufferAttribute(new Float32Array(verts), 3));
    geo.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));
    geo.setAttribute("pine", new BufferAttribute(new Float32Array(pines), 1));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    // Grab the computed normals for base vertices
    const baseNormals = (geo.getAttribute("normal") as BufferAttribute).array as Float32Array;
    const normals: number[] = Array.from(baseNormals); // will expand as we add skirts

    // Add skirts to hide cracks: duplicate border vertices lowered downwards and copy normals
    const skirtHeight = size * 0.1 + (t.lod === 1 ? 10 : 0); //10 extra for pine trees
    const pushVertex = (
      wx: number,
      wy: number,
      wz: number,
      u: number,
      v: number,
      nx: number,
      ny: number,
      nz: number,
      pineVal: number,
      invAOVal: number,
      maskVal: number
    ) => {
      verts.push(wx, wy, wz);
      uvs.push(u, v);
      normals.push(nx, ny, nz);
      pines.push(pineVal);
      invAOAndMask.push(invAOVal, maskVal);
      return verts.length / 3 - 1;
    };

    // Collect border indices (top, bottom, left, right edges)
    const borderTop: number[] = [];
    const borderBottom: number[] = [];
    const borderLeft: number[] = [];
    const borderRight: number[] = [];
    for (let i = 0; i < res; i++) {
      borderTop.push(idx(i, 0));
      borderBottom.push(idx(i, res - 1));
    }
    for (let j = 0; j < res; j++) {
      borderLeft.push(idx(0, j));
      borderRight.push(idx(res - 1, j));
    }

    // Create skirt vertices and triangles for each edge, copying source normals
    const addSkirt = (edge: number[], reverse: boolean) => {
      for (let k = 0; k < edge.length - 1; k++) {
        const i0 = edge[k];
        const i1 = edge[k + 1];
        const lx0 = verts[i0 * 3 + 0],
          y0 = verts[i0 * 3 + 1],
          lz0 = verts[i0 * 3 + 2];
        const lx1 = verts[i1 * 3 + 0],
          y1 = verts[i1 * 3 + 1],
          lz1 = verts[i1 * 3 + 2];

        const n0x = normals[i0 * 3 + 0],
          n0y = normals[i0 * 3 + 1],
          n0z = normals[i0 * 3 + 2];
        const n1x = normals[i1 * 3 + 0],
          n1y = normals[i1 * 3 + 1],
          n1z = normals[i1 * 3 + 2];

        // Convert local centered coords to world for UVs: add tile center
        const wx0 = cx + lx0;
        const wz0 = cz + lz0;
        const wx1 = cx + lx1;
        const wz1 = cz + lz1;

        // Recompute UVs from world coordinates for skirts as well (1 UV = 4 meters)
        const s0 = pushVertex(
          lx0,
          y0 - skirtHeight,
          lz0,
          wx0 / 4.0,
          wz0 / 4.0,
          n0x,
          n0y,
          n0z,
          pines[i0],
          invAOAndMask[i0 * 2 + 0],
          0
        );
        const s1 = pushVertex(
          lx1,
          y1 - skirtHeight,
          lz1,
          wx1 / 4.0,
          wz1 / 4.0,
          n1x,
          n1y,
          n1z,
          pines[i1],
          invAOAndMask[i1 * 2 + 0],
          0
        );

        // Two triangles forming quad. Depending on edge direction, flip winding to keep outward facing.
        if (reverse) {
          // reversed winding relative to default
          // (i0, i1, s0) and (i1, s1, s0)
          indices.push(i0, i1, s0, i1, s1, s0);
        } else {
          // default winding
          // (i0, s0, i1) and (i1, s0, s1)
          indices.push(i0, s0, i1, i1, s0, s1);
        }
      }
    };
    // Based on edge traversal: top (left->right) and left (top->bottom) need reversed,
    // bottom (left->right) and right (top->bottom) use default
    if (t.lod > 0) {
      addSkirt(borderTop, true);
      addSkirt(borderBottom, false);
      addSkirt(borderLeft, false);
      addSkirt(borderRight, true);
    }

    // Update geometry with expanded buffers (positions/uvs already arrays; normals updated)
    geo.setAttribute("position", new BufferAttribute(new Float32Array(verts), 3));
    geo.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));
    geo.setAttribute("normal", new BufferAttribute(new Float32Array(normals), 3));
    geo.setAttribute("pine", new BufferAttribute(new Float32Array(pines), 1));
    geo.setAttribute("invAOAndMask", new BufferAttribute(new Float32Array(invAOAndMask), 2));
    geo.setIndex(indices);

    const mesh = new Mesh(geo, this.material);
    mesh.customDepthMaterial = this.depthMaterial;
    // mesh.customDistanceMaterial = this.depthMaterial;
    // Place mesh at the tile center so local vertices cluster around origin
    mesh.position.set(cx, 0, cz);
    mesh.updateMatrixWorld();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    geo.boundingBox = new Box3(
      new Vector3(size * -0.5, low, size * -0.5),
      new Vector3(size * 0.5, high, size * 0.5)
    );
    if (t.lod === 0) {
      const grass = this.grassSystem.makePointCloudTileOnTerrainGeometry(mesh.position, geo);
      if (grass) {
        mesh.add(grass);
      }
      mesh.updateMatrixWorld(true);
    }
    return mesh;
  }
}
