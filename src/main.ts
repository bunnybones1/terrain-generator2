import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  AmbientLight,
  AxesHelper,
  Color,
  DirectionalLight,
  GridHelper,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector2,
  WebGLRenderer,
  BufferGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Vector3,
  Frustum,
} from "three";
import { createNoise3D } from "simplex-noise";
import { simplifyMesh } from "./simplifyMesh";

// 3D area container
const view3d = document.createElement("div");
// view3d.style.cssText = "position:relative;";
document.body.appendChild(view3d);

// js setup
const renderer = new WebGLRenderer({ antialias: true });
renderer.setSize(view3d.clientWidth || window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = 2; // PCFSoftShadowMap for softer shadows
view3d.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(0x87ceeb); // Sky blue

const camera = new PerspectiveCamera(
  55,
  (view3d.clientWidth || window.innerWidth) / window.innerHeight,
  0.1,
  1000
);
camera.position.set(3, 2, 5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new AmbientLight(0xffffff, 0.35));
const dirLight = new DirectionalLight(0xffffff, 1.5);
dirLight.position.set(5, 8, 3);
dirLight.castShadow = true;

// Configure shadow properties for better quality
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 50;
dirLight.shadow.camera.left = -10;
dirLight.shadow.camera.right = 10;
dirLight.shadow.camera.top = 10;
dirLight.shadow.camera.bottom = -10;
dirLight.shadow.bias = -0.0001;

scene.add(dirLight);

// Helpers
const grid = new GridHelper(10, 10, 0x333333, 0x222222);
scene.add(grid);
const axes = new AxesHelper(1);
scene.add(axes);

// Terrain parameters
const terrainSize = 10; // world units across
const segments = 100; // 100x100 grid of segments (=> 101x101 vertices)
const noiseScale = 0.15;
const noiseAmplitude = 0.6;
const timeSpeed = 0.05;

// Multi-octave simplex noise
const numOctaves = 4;
const octaves: Array<{
  noise: ReturnType<typeof createNoise3D>;
  amplitude: number;
  frequency: number;
}> = [];

function initializeNoise() {
  octaves.length = 0;
  for (let i = 0; i < numOctaves; i++) {
    octaves.push({
      noise: createNoise3D(),
      amplitude: Math.pow(0.5, i), // Each octave has half the amplitude
      frequency: Math.pow(2, i), // Each octave has double the frequency
    });
  }
}

initializeNoise();

// Standalone low-frequency noise (do not reuse octave 0)
const lowFreqNoise3D = createNoise3D();

// Create plane geometry with 100x100 segments, lying on XZ
const terrainGeo = new PlaneGeometry(terrainSize, terrainSize, segments, segments);
terrainGeo.rotateX(-Math.PI / 2);

const terrainMat = new MeshStandardMaterial({
  color: 0x88aa66,
  roughness: 0.95,
  metalness: 0.0,
  flatShading: false,
});

const terrain = new Mesh(terrainGeo, terrainMat);
terrain.castShadow = true;
terrain.receiveShadow = true;
scene.add(terrain);

// Materials for separated meshes
const greenMat = new MeshStandardMaterial({
  color: 0x88aa66,
  roughness: 0.95,
  metalness: 0.0,
  flatShading: false,
});

const brownMat = new MeshStandardMaterial({
  color: 0x8b6f47,
  roughness: 0.95,
  metalness: 0.0,
  flatShading: false,
});

let greenMesh: Mesh | null = null;
let brownMesh: Mesh | null = null;

// Grass system
let grassMesh: InstancedMesh | null = null;
const grassPositions: Vector3[] = [];
const grassNormals: Vector3[] = [];
const grassRotations: number[] = []; // Store Y-axis rotation for each blade
const grassScales: number[] = []; // Store scale for each blade
const grassChunks: Map<string, number[]> = new Map();
const CHUNK_SIZE = 1.0; // Size of spatial grid chunks
const MAX_GRASS_INSTANCES = 100000;
const GRASS_DENSITY = 1000; // Grass blades per unit area
const MAX_GRASS_DISTANCE = 8.0; // Maximum distance from camera to render grass

// Store original grid positions (X and Z)
const originalX = new Float32Array(terrainGeo.attributes.position.count);
const originalZ = new Float32Array(terrainGeo.attributes.position.count);
for (let i = 0; i < terrainGeo.attributes.position.count; i++) {
  originalX[i] = terrainGeo.attributes.position.getX(i);
  originalZ[i] = terrainGeo.attributes.position.getZ(i);
}

// Create grass blade geometry - a simple curved blade
function createGrassBladeGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  const width = 0.02;
  const height = 0.15;
  const segments = 3;

  const vertices: number[] = [];
  const indices: number[] = [];

  // Create blade vertices (bent slightly)
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const y = t * height;
    const bend = t * t * 0.1; // Quadratic bend
    const w = width * (1 - t * 0.7); // Taper toward tip

    vertices.push(-w / 2 + bend, y, 0);
    vertices.push(w / 2 + bend, y, 0);
  }

  // Create indices for triangles
  for (let i = 0; i < segments; i++) {
    const base = i * 2;
    indices.push(base, base + 1, base + 2);
    indices.push(base + 1, base + 3, base + 2);
  }

  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  // Override normals for bottom 2 vertices to point directly up
  const normals = geometry.attributes.normal as Float32BufferAttribute;
  normals.setXYZ(0, 0, 1, 0); // Bottom left vertex
  normals.setXYZ(1, 0, 1, 0); // Bottom right vertex

  // Blend other vertex normals 80% toward up vector
  const upX = 0, upY = 1, upZ = 0;
  const vertCount = geometry.attributes.position.count;
  for (let i = 2; i < vertCount; i++) {
    const nx = normals.getX(i);
    const ny = normals.getY(i);
    const nz = normals.getZ(i);

    // Blend: 80% up, 20% original
    let bx = upX * 0.5 + nx * 0.5;
    let by = upY * 0.5 + ny * 0.5;
    let bz = upZ * 0.5 + nz * 0.5;

    // Normalize blended normal
    const len = Math.hypot(bx, by, bz) || 1.0;
    bx /= len; by /= len; bz /= len;

    normals.setXYZ(i, bx, by, bz);
  }

  normals.needsUpdate = true;

  return geometry;
}

// Scatter grass positions on mesh surface
function scatterGrassOnMesh(mesh: Mesh): void {
  if (!mesh.geometry.index) return;

  grassPositions.length = 0;
  grassNormals.length = 0;
  grassRotations.length = 0;
  grassScales.length = 0;
  grassChunks.clear();

  const pos = mesh.geometry.attributes.position;
  const index = mesh.geometry.index;
  const triangleCount = index.count / 3;

  // Calculate total area for density distribution
  let totalArea = 0;
  const areas: number[] = [];

  for (let i = 0; i < triangleCount; i++) {
    const i0 = index.getX(i * 3);
    const i1 = index.getX(i * 3 + 1);
    const i2 = index.getX(i * 3 + 2);

    const v0 = new Vector3(pos.getX(i0), pos.getY(i0), pos.getZ(i0));
    const v1 = new Vector3(pos.getX(i1), pos.getY(i1), pos.getZ(i1));
    const v2 = new Vector3(pos.getX(i2), pos.getY(i2), pos.getZ(i2));

    const e1 = new Vector3().subVectors(v1, v0);
    const e2 = new Vector3().subVectors(v2, v0);
    const area = e1.cross(e2).length() * 0.5;

    areas.push(area);
    totalArea += area;
  }

  // Scatter grass based on triangle area
  const targetGrassCount = Math.min(totalArea * GRASS_DENSITY, MAX_GRASS_INSTANCES);

  for (let i = 0; i < triangleCount && grassPositions.length < targetGrassCount; i++) {
    const i0 = index.getX(i * 3);
    const i1 = index.getX(i * 3 + 1);
    const i2 = index.getX(i * 3 + 2);

    const v0 = new Vector3(pos.getX(i0), pos.getY(i0), pos.getZ(i0));
    const v1 = new Vector3(pos.getX(i1), pos.getY(i1), pos.getZ(i1));
    const v2 = new Vector3(pos.getX(i2), pos.getY(i2), pos.getZ(i2));

    // Calculate face normal
    const e1 = new Vector3().subVectors(v1, v0);
    const e2 = new Vector3().subVectors(v2, v0);
    const normal = new Vector3().crossVectors(e1, e2).normalize();

    // Number of grass blades for this triangle proportional to its area
    const grassCount = Math.ceil((areas[i] / totalArea) * targetGrassCount);

    for (let j = 0; j < grassCount; j++) {
      // Random point in triangle using barycentric coordinates
      let r1 = Math.random();
      let r2 = Math.random();
      if (r1 + r2 > 1) {
        r1 = 1 - r1;
        r2 = 1 - r2;
      }
      const r3 = 1 - r1 - r2;

      const position = new Vector3()
        .addScaledVector(v0, r1)
        .addScaledVector(v1, r2)
        .addScaledVector(v2, r3);

      grassPositions.push(position);
      grassNormals.push(normal.clone());

      // Add to spatial chunk
      const chunkKey = `${Math.floor(position.x / CHUNK_SIZE)},${Math.floor(position.z / CHUNK_SIZE)}`;
      if (!grassChunks.has(chunkKey)) {
        grassChunks.set(chunkKey, []);
      }
      grassChunks.get(chunkKey)!.push(grassPositions.length - 1);
    }
  }

  console.log(`Scattered ${grassPositions.length} grass blades`);
}

// Create instanced grass mesh
function createGrassMesh(): void {
  if (grassMesh) {
    scene.remove(grassMesh);
    grassMesh.geometry.dispose();
    if (Array.isArray(grassMesh.material)) {
      grassMesh.material.forEach((m) => m.dispose());
    } else {
      grassMesh.material.dispose();
    }
  }

  if (grassPositions.length === 0) return;

  const grassGeometry = createGrassBladeGeometry();

  grassMesh = new InstancedMesh(grassGeometry, greenMat, grassPositions.length);
  grassMesh.castShadow = false;
  grassMesh.receiveShadow = true;

  // Clear and repopulate transform arrays
  grassRotations.length = 0;
  grassScales.length = 0;

  // Set initial transforms for all grass instances
  const matrix = new Matrix4();
  const rotationAxis = new Vector3(0, 1, 0);

  for (let i = 0; i < grassPositions.length; i++) {
    const position = grassPositions[i];
    const normal = grassNormals[i];

    // Random rotation around Y axis
    const rotation = Math.random() * Math.PI * 2;

    // Random scale variation
    const scale = 0.8 + Math.random() * 0.4;

    // Store transform properties
    grassRotations.push(rotation);
    grassScales.push(scale);

    // Create transform matrix
    matrix.identity();
    matrix.makeRotationAxis(rotationAxis, rotation);
    matrix.scale(new Vector3(scale, scale, scale));
    matrix.setPosition(position);

    grassMesh.setMatrixAt(i, matrix);
  }

  grassMesh.instanceMatrix.needsUpdate = true;
  scene.add(grassMesh);
}

// Update visible grass instances based on camera frustum
const _frustum = new Frustum();
const _projScreenMatrix = new Matrix4();
const _cameraPos = new Vector3();
function updateGrassVisibility(): void {
  if (!grassMesh || grassPositions.length === 0) return;

  // Update frustum from camera
  _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _frustum.setFromProjectionMatrix(_projScreenMatrix);

  // Get camera position
  camera.getWorldPosition(_cameraPos);

  // Check each grass position and update visibility
  let visibleCount = 0;
  const matrix = new Matrix4();
  const position = new Vector3();
  const rotationAxis = new Vector3(0, 1, 0);

  for (let i = 0; i < grassPositions.length; i++) {
    position.copy(grassPositions[i]);

    // Calculate distance from camera
    const distanceFromCamera = position.distanceTo(_cameraPos);

    // Check if grass is within frustum and distance range
    const isInFrustum = _frustum.containsPoint(position);
    const isWithinDistance = distanceFromCamera <= MAX_GRASS_DISTANCE;
    const isVisible = isInFrustum && isWithinDistance;

    if (isVisible) {
      // Restore original transform using stored rotation and scale
      const rotation = grassRotations[i];
      const scale = grassScales[i];

      matrix.identity();
      matrix.makeRotationAxis(rotationAxis, rotation);
      matrix.scale(new Vector3(scale, scale, scale));
      matrix.setPosition(grassPositions[i]);

      grassMesh.setMatrixAt(i, matrix);
      visibleCount++;
    } else {
      // Hide grass by scaling to zero
      matrix.makeScale(0, 0, 0);
      grassMesh.setMatrixAt(i, matrix);
    }
  }

  grassMesh.instanceMatrix.needsUpdate = true;
}

// Displace vertices by simplex noise
const _uv = new Vector2();
function updateTerrain(timeSec: number) {
  const pos = terrainGeo.attributes.position;
  const count = pos.count;

  // Reset X and Z to original grid positions
  for (let i = 0; i < count; i++) {
    pos.setX(i, originalX[i]);
    pos.setZ(i, originalZ[i]);
  }

  // Initial noise displacement using multi-octave noise
  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);

    _uv.set(x * noiseScale, z * noiseScale);
    const t = timeSec * timeSpeed;

    let n = 0;
    for (const octave of octaves) {
      n +=
        octave.amplitude *
        octave.noise(_uv.x * octave.frequency, _uv.y * octave.frequency, t * octave.frequency);
    }

    // Low-frequency modulation for amplitude: noise in [-1,1] -> [0.5, 3]
    const lowFreqNoise = lowFreqNoise3D(_uv.x * 0.2, _uv.y * 0.2, t * 0.2); // very low frequency
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
  terrainGeo.computeVertexNormals();

  // Simplify mesh
  const simplifiedGeo = simplifyMesh(terrainGeo, 0.5);

  // Separate simplified terrain into top-facing and side-facing meshes
  separateTerrainByOrientation(simplifiedGeo);
}
function separateTerrainByOrientation(geo: BufferGeometry): void {
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
  if (greenMesh) scene.remove(greenMesh);
  if (brownMesh) scene.remove(brownMesh);

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
    greenMesh = new Mesh(greenGeo, greenMat);
    greenMesh.castShadow = true;
    greenMesh.receiveShadow = true;
    scene.add(greenMesh);

    // Generate grass on green mesh
    scatterGrassOnMesh(greenMesh);
    createGrassMesh();
  }

  // Create brown mesh for side faces
  if (sideIndices.length > 0) {
    const brownGeo = createIndexedGeometry(sideIndices, true);
    brownMesh = new Mesh(brownGeo, brownMat);
    brownMesh.castShadow = true;
    brownMesh.receiveShadow = true;
    scene.add(brownMesh);
  }
  // Hide original terrain
  terrain.visible = false;
}
// Resize handling
function resize() {
  const width = view3d.clientWidth || window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);

// Re-seed and export handlers
window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  if (key === "r") {
    initializeNoise();
    updateTerrain(0);
  } else if (key === "e") {
    //EXPORT
  }
});

updateTerrain(0);

// Render loop
// const startTime = performance.now();
function loop() {
  // const now = performance.now();
  // const tSec = (now - startTime) / 10000;

  // updateTerrain(tSec);

  controls.update();

  // Update grass visibility based on camera frustum
  updateGrassVisibility();

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
resize();
loop();
