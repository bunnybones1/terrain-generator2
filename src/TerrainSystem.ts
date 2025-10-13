import {
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Scene,
  Vector2,
  BufferGeometry,
  Float32BufferAttribute,
  Camera,
} from "three";
import { createNoise3D } from "simplex-noise";
import { simplifyMesh } from "./simplifyMesh";
import GrassSubsystem from "./GrassSubsystem";

// Terrain parameters
const terrainSize = 10; // world units across
const segments = 100; // 100x100 grid of segments (=> 101x101 vertices)
const noiseScale = 0.15;
const noiseAmplitude = 0.6;
const timeSpeed = 0.05;

// Multi-octave simplex noise
const numOctaves = 4;
export default class TerrainSystem {
  private octaves: Array<{
    noise: ReturnType<typeof createNoise3D>;
    amplitude: number;
    frequency: number;
  }> = [];
  // Standalone low-frequency noise (do not reuse octave 0)
  private lowFreqNoise3D = createNoise3D();
  private terrainGeo = new PlaneGeometry(terrainSize, terrainSize, segments, segments);
  private terrainMat = new MeshStandardMaterial({
    color: 0x88aa66,
    roughness: 0.95,
    metalness: 0.0,
    flatShading: false,
  });
  private terrain = new Mesh(this.terrainGeo, this.terrainMat);
  private originalX = new Float32Array(this.terrainGeo.attributes.position.count);
  private originalZ = new Float32Array(this.terrainGeo.attributes.position.count);
  private grass: GrassSubsystem;
  constructor(
    private scene: Scene,
    private camera: Camera
  ) {
    // Create plane geometry with 100x100 segments, lying on XZ
    this.terrainGeo.rotateX(-Math.PI / 2);

    this.terrain.castShadow = true;
    this.terrain.receiveShadow = true;
    scene.add(this.terrain);

    // Store original grid positions (X and Z)
    for (let i = 0; i < this.terrainGeo.attributes.position.count; i++) {
      this.originalX[i] = this.terrainGeo.attributes.position.getX(i);
      this.originalZ[i] = this.terrainGeo.attributes.position.getZ(i);
    }
    this.grass = new GrassSubsystem(scene, camera);
    this.initializeNoise();
  }

  public initializeNoise() {
    this.octaves.length = 0;
    for (let i = 0; i < numOctaves; i++) {
      this.octaves.push({
        noise: createNoise3D(),
        amplitude: Math.pow(0.5, i), // Each octave has half the amplitude
        frequency: Math.pow(2, i), // Each octave has double the frequency
      });
    }
    this.regenerate(0);
  }

  // Materials for separated meshes
  private greenMat = new MeshStandardMaterial({
    color: 0x88aa66,
    roughness: 0.95,
    metalness: 0.0,
    flatShading: false,
  });

  private brownMat = new MeshStandardMaterial({
    color: 0x8b6f47,
    roughness: 0.95,
    metalness: 0.0,
    flatShading: false,
  });

  private greenMesh: Mesh | null = null;
  private brownMesh: Mesh | null = null;

  // Displace vertices by simplex noise
  _uv = new Vector2();
  public regenerate(timeSec: number) {
    const pos = this.terrainGeo.attributes.position;
    const count = pos.count;

    // Reset X and Z to original grid positions
    for (let i = 0; i < count; i++) {
      pos.setX(i, this.originalX[i]);
      pos.setZ(i, this.originalZ[i]);
    }

    // Initial noise displacement using multi-octave noise
    for (let i = 0; i < count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);

      this._uv.set(x * noiseScale, z * noiseScale);
      const t = timeSec * timeSpeed;

      let n = 0;
      for (const octave of this.octaves) {
        n +=
          octave.amplitude *
          octave.noise(
            this._uv.x * octave.frequency,
            this._uv.y * octave.frequency,
            t * octave.frequency
          );
      }

      // Low-frequency modulation for amplitude: noise in [-1,1] -> [0.5, 3]
      const lowFreqNoise = this.lowFreqNoise3D(this._uv.x * 0.2, this._uv.y * 0.2, t * 0.2); // very low frequency
      const ampMod = 0.5 + (lowFreqNoise + 1) * 0.5 * (3 - 0.5); // map to [0.5, 3]
      pos.setY(i, n * noiseAmplitude * ampMod);
    }

    // Iteratively move vertices toward neighbor with biggest height difference
    const vertsPerSide = segments + 1;
    const currentPos = new Float32Array(count * 3);
    const nextPos = new Float32Array(count * 3);

    // Copy current positions to working buffer
    for (let i = 0; i < count; i++) {
      currentPos[i * 3 + 0] = pos.getX(i);
      currentPos[i * 3 + 1] = pos.getY(i);
      currentPos[i * 3 + 2] = pos.getZ(i);
    }

    const iterations = 5;

    // Compute min and max height for normalization
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < count; i++) {
      const y = currentPos[i * 3 + 1];
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const invRange = maxY > minY ? 1 / (maxY - minY) : 0;

    for (let iter = 0; iter < iterations; iter++) {
      for (let idx = 0; idx < count; idx++) {
        const baseIdx = idx * 3;
        const vx = currentPos[baseIdx + 0];
        const vy = currentPos[baseIdx + 1];
        const vz = currentPos[baseIdx + 2];

        // Compute grid coordinates
        const row = Math.floor(idx / vertsPerSide);
        const col = idx % vertsPerSide;

        let maxDiff = -Infinity;
        let targetX = vx;
        // const targetY = vy;
        let targetZ = vz;

        // Check 4 neighbors (up, down, left, right)
        const neighbors = [];
        if (row > 0) neighbors.push((row - 1) * vertsPerSide + col); // up
        if (row < vertsPerSide - 1) neighbors.push((row + 1) * vertsPerSide + col); // down
        if (col > 0) neighbors.push(row * vertsPerSide + (col - 1)); // left
        if (col < vertsPerSide - 1) neighbors.push(row * vertsPerSide + (col + 1)); // right

        for (const nIdx of neighbors) {
          const nBaseIdx = nIdx * 3;
          const ny = currentPos[nBaseIdx + 1];
          const diff = Math.abs(ny - vy);

          if (diff > maxDiff) {
            maxDiff = diff;
            targetX = currentPos[nBaseIdx + 0];
            // targetY = currentPos[nBaseIdx + 1];
            targetZ = currentPos[nBaseIdx + 2];
          }
        }

        // Movement factor between 0% and 50% based on relative height
        const t = invRange ? (vy - minY) * invRange : 0; // 0 at min height, 1 at max height
        const moveFactor = 0.3 * Math.min(Math.max(t, 0), 1);

        nextPos[baseIdx + 0] = vx + moveFactor * (targetX - vx);
        nextPos[baseIdx + 1] = vy;
        // nextPos[baseIdx + 1] = vy + moveFactor * (targetY - vy);
        nextPos[baseIdx + 2] = vz + moveFactor * (targetZ - vz);
      }

      // Swap buffers
      for (let i = 0; i < count * 3; i++) {
        currentPos[i] = nextPos[i];
      }
    }

    // Write final positions back to geometry
    for (let i = 0; i < count; i++) {
      pos.setXYZ(i, currentPos[i * 3 + 0], currentPos[i * 3 + 1], currentPos[i * 3 + 2]);
    }

    pos.needsUpdate = true;
    this.terrainGeo.computeVertexNormals();

    // Simplify mesh
    const simplifiedGeo = simplifyMesh(this.terrainGeo, 0.5);

    // Separate simplified terrain into top-facing and side-facing meshes
    this.separateTerrainByOrientation(simplifiedGeo);
  }
  private separateTerrainByOrientation(geo: BufferGeometry): void {
    const pos = geo.attributes.position;
    const index = geo.index;

    if (!index) return;

    const topIndices: number[] = [];
    const sideIndices: number[] = [];

    const threshold = 0.7; // normals with y > 0.7 are considered top-facing

    // Iterate through all triangles
    for (let i = 0; i < index.count; i += 3) {
      const i0 = index.getX(i);
      const i1 = index.getX(i + 1);
      const i2 = index.getX(i + 2);

      // Get vertices
      const v0x = pos.getX(i0),
        v0y = pos.getY(i0),
        v0z = pos.getZ(i0);
      const v1x = pos.getX(i1),
        v1y = pos.getY(i1),
        v1z = pos.getZ(i1);
      const v2x = pos.getX(i2),
        v2y = pos.getY(i2),
        v2z = pos.getZ(i2);

      // Calculate face normal using cross product
      const e1x = v1x - v0x,
        e1y = v1y - v0y,
        e1z = v1z - v0z;
      const e2x = v2x - v0x,
        e2y = v2y - v0y,
        e2z = v2z - v0z;

      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;

      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const normalY = len > 0 ? ny / len : 0;

      // Separate based on normal Y component
      if (normalY > threshold) {
        topIndices.push(i0, i1, i2);
      } else {
        sideIndices.push(i0, i1, i2);
      }
    }

    // Remove old meshes if they exist
    if (this.greenMesh) this.scene.remove(this.greenMesh);
    if (this.brownMesh) this.scene.remove(this.brownMesh);

    // Helper function to create indexed geometry from indices
    function createIndexedGeometry(indices: number[], jaggy = false): BufferGeometry {
      // Build vertex map to deduplicate
      const vertexMap = new Map<string, number>();
      const vertices: number[] = [];
      const newIndices: number[] = [];

      for (const origIdx of indices) {
        const x = pos.getX(origIdx);
        const y = pos.getY(origIdx);
        const z = pos.getZ(origIdx);

        const key = `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;

        let newIdx = vertexMap.get(key);
        if (newIdx === undefined) {
          newIdx = vertices.length / 3;
          vertexMap.set(key, newIdx);
          vertices.push(x, y, z);
        }

        newIndices.push(newIdx);
      }

      const geo = new BufferGeometry();
      geo.setAttribute("position", new Float32BufferAttribute(vertices, 3));
      geo.setIndex(newIndices);
      geo.computeVertexNormals();

      // Jaggy feature: extrude steepest 10% of faces
      if (jaggy) {
        const faceCount = newIndices.length / 3;
        const faceData: Array<{ index: number; steepness: number }> = [];

        // Calculate steepness for each face
        for (let i = 0; i < faceCount; i++) {
          const i0 = newIndices[i * 3 + 0];
          const i1 = newIndices[i * 3 + 1];
          const i2 = newIndices[i * 3 + 2];

          const v0x = vertices[i0 * 3],
            v0y = vertices[i0 * 3 + 1],
            v0z = vertices[i0 * 3 + 2];
          const v1x = vertices[i1 * 3],
            v1y = vertices[i1 * 3 + 1],
            v1z = vertices[i1 * 3 + 2];
          const v2x = vertices[i2 * 3],
            v2y = vertices[i2 * 3 + 1],
            v2z = vertices[i2 * 3 + 2];

          // Calculate face normal
          const e1x = v1x - v0x,
            e1y = v1y - v0y,
            e1z = v1z - v0z;
          const e2x = v2x - v0x,
            e2y = v2y - v0y,
            e2z = v2z - v0z;

          const nx = e1y * e2z - e1z * e2y;
          const ny = e1z * e2x - e1x * e2z;
          const nz = e1x * e2y - e1y * e2x;

          const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
          const normalY = len > 0 ? ny / len : 0;

          // Steepness = 1 - abs(normalY) (horizontal faces = 1, vertical = 0)
          const steepness = 1 - Math.abs(normalY);
          faceData.push({ index: i, steepness });
        }

        // Sort by steepness and get top 10%
        faceData.sort((a, b) => b.steepness - a.steepness);
        const steepCount = Math.ceil(faceCount * 0.4);
        const steepFaces = faceData.slice(0, steepCount);

        // Extrude steep faces
        const extrusionAmount = 0.05;
        const newVertices = [...vertices];
        const newFaces: number[] = [...newIndices];

        for (const { index: faceIdx } of steepFaces) {
          const i0 = newIndices[faceIdx * 3 + 0];
          const i1 = newIndices[faceIdx * 3 + 1];
          const i2 = newIndices[faceIdx * 3 + 2];

          const v0x = vertices[i0 * 3],
            v0y = vertices[i0 * 3 + 1],
            v0z = vertices[i0 * 3 + 2];
          const v1x = vertices[i1 * 3],
            v1y = vertices[i1 * 3 + 1],
            v1z = vertices[i1 * 3 + 2];
          const v2x = vertices[i2 * 3],
            v2y = vertices[i2 * 3 + 1],
            v2z = vertices[i2 * 3 + 2];

          const randomness = 0.06;

          // Update positions in newVertices array
          newVertices[i0 * 3 + 0] = v0x;
          newVertices[i0 * 3 + 1] = v0y;
          newVertices[i0 * 3 + 2] = v0z;

          newVertices[i1 * 3 + 0] = v1x;
          newVertices[i1 * 3 + 1] = v1y;
          newVertices[i1 * 3 + 2] = v1z;

          newVertices[i2 * 3 + 0] = v2x;
          newVertices[i2 * 3 + 1] = v2y;
          newVertices[i2 * 3 + 2] = v2z;

          // Calculate face normal
          const e1x = v1x - v0x,
            e1y = v1y - v0y,
            e1z = v1z - v0z;
          const e2x = v2x - v0x,
            e2y = v2y - v0y,
            e2z = v2z - v0z;

          let nx = e1y * e2z - e1z * e2y;
          let ny = e1z * e2x - e1x * e2z;
          let nz = e1x * e2y - e1y * e2x;

          const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
          if (len > 0) {
            nx /= len;
            ny /= len;
            nz /= len;
          }

          // Calculate face center
          const centerX = (v0x + v1x + v2x) / 3;
          const centerY = (v0y + v1y + v2y) / 3;
          const centerZ = (v0z + v1z + v2z) / 3;

          // Scale factor for extruded face
          const scaleFactor = 0.6;

          // Scale vertices toward center (60% of original size)
          const sv0x = centerX + (v0x - centerX) * scaleFactor;
          const sv0y = centerY + (v0y - centerY) * scaleFactor;
          const sv0z = centerZ + (v0z - centerZ) * scaleFactor;

          const sv1x = centerX + (v1x - centerX) * scaleFactor;
          const sv1y = centerY + (v1y - centerY) * scaleFactor;
          const sv1z = centerZ + (v1z - centerZ) * scaleFactor;

          const sv2x = centerX + (v2x - centerX) * scaleFactor;
          const sv2y = centerY + (v2y - centerY) * scaleFactor;
          const sv2z = centerZ + (v2z - centerZ) * scaleFactor;

          // Create extruded vertices with randomness
          const e0 = newVertices.length / 3;
          const e1 = e0 + 1;
          const e2 = e0 + 2;

          newVertices.push(
            sv0x + nx * extrusionAmount + (Math.random() - 0.5) * randomness,
            sv0y + ny * extrusionAmount + (Math.random() - 0.5) * randomness,
            sv0z + nz * extrusionAmount + (Math.random() - 0.5) * randomness,
            sv1x + nx * extrusionAmount + (Math.random() - 0.5) * randomness,
            sv1y + ny * extrusionAmount + (Math.random() - 0.5) * randomness,
            sv1z + nz * extrusionAmount + (Math.random() - 0.5) * randomness,
            sv2x + nx * extrusionAmount + (Math.random() - 0.5) * randomness,
            sv2y + ny * extrusionAmount + (Math.random() - 0.5) * randomness,
            sv2z + nz * extrusionAmount + (Math.random() - 0.5) * randomness
          );

          // Replace original face with extruded face
          newFaces[faceIdx * 3 + 0] = e0;
          newFaces[faceIdx * 3 + 1] = e1;
          newFaces[faceIdx * 3 + 2] = e2;

          // Add side faces connecting original to extruded
          // Edge 0-1
          newFaces.push(i0, i1, e1, i0, e1, e0);
          // Edge 1-2
          newFaces.push(i1, i2, e2, i1, e2, e1);
          // Edge 2-0
          newFaces.push(i2, i0, e0, i2, e0, e2);
        }

        // Rebuild geometry with extruded faces
        const extrudedGeo = new BufferGeometry();
        extrudedGeo.setAttribute("position", new Float32BufferAttribute(newVertices, 3));
        extrudedGeo.setIndex(newFaces);
        extrudedGeo.computeVertexNormals();

        return extrudedGeo;
      }

      return geo;
    }

    // Create green mesh for top faces
    if (topIndices.length > 0) {
      const greenGeo = createIndexedGeometry(topIndices);
      this.greenMesh = new Mesh(greenGeo, this.greenMat);
      this.greenMesh.castShadow = true;
      this.greenMesh.receiveShadow = true;
      this.scene.add(this.greenMesh);

      // Generate grass on green mesh
      this.grass.scatterGrassOnMesh(this.greenMesh);
    }

    // Create brown mesh for side faces
    if (sideIndices.length > 0) {
      const brownGeo = createIndexedGeometry(sideIndices, true);
      this.brownMesh = new Mesh(brownGeo, this.brownMat);
      this.brownMesh.castShadow = true;
      this.brownMesh.receiveShadow = true;
      this.scene.add(this.brownMesh);
    }
    // Hide original terrain
    this.terrain.visible = false;
  }

  // Render loop
  public update() {
    // Update grass visibility based on camera frustum
    this.grass.update();
  }
}
