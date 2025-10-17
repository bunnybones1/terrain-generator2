import {
  BufferAttribute,
  BufferGeometry,
  Camera,
  Color,
  Mesh,
  MeshStandardMaterial,
  Scene,
  Vector3,
} from "three";
import { TerrainData, TileCoords } from "./TerrainData";
import { makeTerrainMaterial } from "./materials";

type TileEntry = {
  mesh: Mesh;
  key: string;
};

export class TerrainRenderer {
  public tiles = new Map<string, TileEntry>();

  constructor(
    private data: TerrainData,
    private scene: Scene,
    private cameraPosition: Vector3
  ) {}

  updateAndRender(camera: Camera, visible: TileCoords[]): void {
    const keep = new Set<string>();
    for (const t of visible) {
      const key = `${t.tx}:${t.tz}:${t.lod}`;
      keep.add(key);
      if (!this.tiles.has(key)) {
        const mesh = this.buildTile(t);
        this.scene.add(mesh);
        this.tiles.set(key, { mesh, key });
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
    const indices: number[] = [];
    const useBaseForHighLod = t.lod < 1;
    // const useBaseForHighLod = false;
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const fx = i / (res - 1);
        const fz = j / (res - 1);
        const wx = x + fx * size;
        const wz = z + fz * size;
        const terrainSample = this.data.getSample(wx, wz);
        const wy = useBaseForHighLod ? terrainSample.baseHeight : terrainSample.height;
        verts.push(wx, wy, wz);
        pines.push(useBaseForHighLod ? 0 : (terrainSample.pine ?? 0));
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
    const skirtHeight = size * 0.1;
    const pushVertex = (
      wx: number,
      wy: number,
      wz: number,
      u: number,
      v: number,
      nx: number,
      ny: number,
      nz: number,
      pineVal: number
    ) => {
      verts.push(wx, wy, wz);
      uvs.push(u, v);
      normals.push(nx, ny, nz);
      pines.push(pineVal);
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
        const x0 = verts[i0 * 3 + 0],
          y0 = verts[i0 * 3 + 1],
          z0 = verts[i0 * 3 + 2];
        const x1 = verts[i1 * 3 + 0],
          y1 = verts[i1 * 3 + 1],
          z1 = verts[i1 * 3 + 2];

        const n0x = normals[i0 * 3 + 0],
          n0y = normals[i0 * 3 + 1],
          n0z = normals[i0 * 3 + 2];
        const n1x = normals[i1 * 3 + 0],
          n1y = normals[i1 * 3 + 1],
          n1z = normals[i1 * 3 + 2];

        // Recompute UVs from world coordinates for skirts as well (1 UV = 4 meters)
        const s0 = pushVertex(
          x0,
          y0 - skirtHeight,
          z0,
          x0 / 4.0,
          z0 / 4.0,
          n0x,
          n0y,
          n0z,
          pines[i0]
        );
        const s1 = pushVertex(
          x1,
          y1 - skirtHeight,
          z1,
          x1 / 4.0,
          z1 / 4.0,
          n1x,
          n1y,
          n1z,
          pines[i1]
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
    addSkirt(borderTop, true);
    addSkirt(borderBottom, false);
    addSkirt(borderLeft, false);
    addSkirt(borderRight, true);

    // Update geometry with expanded buffers (positions/uvs already arrays; normals updated)
    geo.setAttribute("position", new BufferAttribute(new Float32Array(verts), 3));
    geo.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));
    geo.setAttribute("normal", new BufferAttribute(new Float32Array(normals), 3));
    geo.setAttribute("pine", new BufferAttribute(new Float32Array(pines), 1));
    geo.setIndex(indices);

    // Slope can be derived from normals in shader; no need to store as attribute

    const mesh = new Mesh(geo, this.getMaterial());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
  material: MeshStandardMaterial | undefined;
  getMaterial() {
    if (!this.material) {
      this.material = makeTerrainMaterial(this.cameraPosition);
    }
    return this.material;
  }
  sunMaterial: MeshStandardMaterial | undefined;
  getSunMaterial() {
    if (!this.sunMaterial) {
      this.sunMaterial = makeTerrainMaterial(this.cameraPosition);
      this.sunMaterial.emissive = new Color(1, 1, 0.1);
      this.sunMaterial.emissiveIntensity = 1000;
    }
    return this.sunMaterial;
  }
}
