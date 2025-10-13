import {
  Mesh,
  MeshStandardMaterial,
  Scene,
  BufferGeometry,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Vector3,
  Frustum,
  Camera,
} from "three";

//grass
const CHUNK_SIZE = 1.0; // Size of spatial grid chunks
const MAX_GRASS_INSTANCES = 100000;
const GRASS_DENSITY = 1000; // Grass blades per unit area
const MAX_GRASS_DISTANCE = 8.0; // Maximum distance from camera to render grass

export default class GrassSubsystem {
  constructor(
    private scene: Scene,
    private camera: Camera
  ) {
    //
  }
  // Materials for separated meshes
  private greenMat = new MeshStandardMaterial({
    color: 0x88aa66,
    roughness: 0.95,
    metalness: 0.0,
    flatShading: false,
  });

  // Grass system
  private grassMesh: InstancedMesh | null = null;
  private grassPositions: Vector3[] = [];
  private grassNormals: Vector3[] = [];
  private grassRotations: number[] = []; // Store Y-axis rotation for each blade
  private grassScales: number[] = []; // Store scale for each blade
  private grassChunks: Map<string, number[]> = new Map();

  // Create grass blade geometry - a simple curved blade
  private createGrassBladeGeometry(): BufferGeometry {
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
    const upX = 0,
      upY = 1,
      upZ = 0;
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
      bx /= len;
      by /= len;
      bz /= len;

      normals.setXYZ(i, bx, by, bz);
    }

    normals.needsUpdate = true;

    return geometry;
  }

  // Scatter grass positions on mesh surface
  public scatterGrassOnMesh(mesh: Mesh): void {
    if (!mesh.geometry.index) return;

    this.grassPositions.length = 0;
    this.grassNormals.length = 0;
    this.grassRotations.length = 0;
    this.grassScales.length = 0;
    this.grassChunks.clear();

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

    for (let i = 0; i < triangleCount && this.grassPositions.length < targetGrassCount; i++) {
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

        this.grassPositions.push(position);
        this.grassNormals.push(normal.clone());

        // Add to spatial chunk
        const chunkKey = `${Math.floor(position.x / CHUNK_SIZE)},${Math.floor(position.z / CHUNK_SIZE)}`;
        if (!this.grassChunks.has(chunkKey)) {
          this.grassChunks.set(chunkKey, []);
        }
        this.grassChunks.get(chunkKey)!.push(this.grassPositions.length - 1);
      }
    }

    console.log(`Scattered ${this.grassPositions.length} grass blades`);
    this.createGrassMesh();
  }

  // Create instanced grass mesh
  private createGrassMesh(): void {
    if (this.grassMesh) {
      this.scene.remove(this.grassMesh);
      this.grassMesh.geometry.dispose();
      if (Array.isArray(this.grassMesh.material)) {
        this.grassMesh.material.forEach((m) => m.dispose());
      } else {
        this.grassMesh.material.dispose();
      }
    }

    if (this.grassPositions.length === 0) return;

    const grassGeometry = this.createGrassBladeGeometry();

    this.grassMesh = new InstancedMesh(grassGeometry, this.greenMat, this.grassPositions.length);
    this.grassMesh.castShadow = false;
    this.grassMesh.receiveShadow = true;

    // Clear and repopulate transform arrays
    this.grassRotations.length = 0;
    this.grassScales.length = 0;

    // Set initial transforms for all grass instances
    const matrix = new Matrix4();
    const rotationAxis = new Vector3(0, 1, 0);

    for (let i = 0; i < this.grassPositions.length; i++) {
      const position = this.grassPositions[i];
      // const normal = this.grassNormals[i];

      // Random rotation around Y axis
      const rotation = Math.random() * Math.PI * 2;

      // Random scale variation
      const scale = 0.8 + Math.random() * 0.4;

      // Store transform properties
      this.grassRotations.push(rotation);
      this.grassScales.push(scale);

      // Create transform matrix
      matrix.identity();
      matrix.makeRotationAxis(rotationAxis, rotation);
      matrix.scale(new Vector3(scale, scale, scale));
      matrix.setPosition(position);

      this.grassMesh.setMatrixAt(i, matrix);
    }

    this.grassMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.grassMesh);
  }

  // Update visible grass instances based on camera frustum
  _frustum = new Frustum();
  _projScreenMatrix = new Matrix4();
  _cameraPos = new Vector3();
  private updateGrassVisibility(): void {
    if (!this.grassMesh || this.grassPositions.length === 0) return;

    // Update frustum from camera
    this._projScreenMatrix.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse
    );
    this._frustum.setFromProjectionMatrix(this._projScreenMatrix);

    // Get camera position
    this.camera.getWorldPosition(this._cameraPos);

    // Check each grass position and update visibility
    const matrix = new Matrix4();
    const position = new Vector3();
    const rotationAxis = new Vector3(0, 1, 0);

    for (let i = 0; i < this.grassPositions.length; i++) {
      position.copy(this.grassPositions[i]);

      // Calculate distance from camera
      const distanceFromCamera = position.distanceTo(this._cameraPos);

      // Check if grass is within frustum and distance range
      const isInFrustum = this._frustum.containsPoint(position);
      const isWithinDistance = distanceFromCamera <= MAX_GRASS_DISTANCE;
      const isVisible = isInFrustum && isWithinDistance;

      if (isVisible) {
        // Restore original transform using stored rotation and scale
        const rotation = this.grassRotations[i];
        const scale = this.grassScales[i];

        matrix.identity();
        matrix.makeRotationAxis(rotationAxis, rotation);
        matrix.scale(new Vector3(scale, scale, scale));
        matrix.setPosition(this.grassPositions[i]);

        this.grassMesh.setMatrixAt(i, matrix);
      } else {
        // Hide grass by scaling to zero
        matrix.makeScale(0, 0, 0);
        this.grassMesh.setMatrixAt(i, matrix);
      }
    }

    this.grassMesh.instanceMatrix.needsUpdate = true;
  }

  // Render loop
  public update() {
    // Update grass visibility based on camera frustum
    this.updateGrassVisibility();
  }
}
