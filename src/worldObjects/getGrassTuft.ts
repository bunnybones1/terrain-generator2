import { Memoizer } from "memoizer-ts";
import {
  Color,
  ConeGeometry,
  DoubleSide,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";

export function makeGrassTuft(tuftRadius: number) {
  // Defaults
  const bladesPerTuft = 64;
  const bladeHeightRange = [0.15, 0.35];
  const bladeRadius = 0.02;
  const color = new Color(0x4a5a0a);

  // Single blade geometry: a cone pointing up (Y+)
  const segmentsRadial = 6;
  const segmentsHeight = 5;
  const bladeGeom = new ConeGeometry(bladeRadius, 1.0, segmentsRadial, segmentsHeight, true); // unit height, scale per instance
  bladeGeom.translate(0, 0.5, 0); // base at y=0

  // Recompute and adjust normals: bottom verts straight up, others blend 75% toward up
  bladeGeom.computeVertexNormals();
  const posAttr = bladeGeom.getAttribute("position");
  const norAttr = bladeGeom.getAttribute("normal");
  if (posAttr && norAttr) {
    const upY = 1;
    const blend = 0.15;
    const arrN = norAttr.array as Float32Array;
    const arrP = posAttr.array as Float32Array;
    const upX = 0,
      upZ = 0;
    for (let i = 0; i < posAttr.count; i++) {
      // const px = arrP[i * 3 + 0];
      const py = arrP[i * 3 + 1];
      // const pz = arrP[i * 3 + 2];

      let nx = arrN[i * 3 + 0];
      let ny = arrN[i * 3 + 1];
      let nz = arrN[i * 3 + 2];

      // If vertex at base (y≈0), force normal straight up
      if (Math.abs(py) < 1e-5) {
        // nx = 0;
        // ny = 1;
        // nz = 0;
      } else {
        // Blend 75% toward up and renormalize
        nx = nx * (1 - blend) + upX * blend;
        ny = ny * (1 - blend) + upY * blend;
        nz = nz * (1 - blend) + upZ * blend;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;
      }

      arrN[i * 3 + 0] = nx;
      arrN[i * 3 + 1] = ny;
      arrN[i * 3 + 2] = nz;
    }
    norAttr.needsUpdate = true;
  }

  // Material for grass (outputs world-space normals)
  const grassMaterial = new MeshStandardMaterial({
    color: color,
    emissive: color,
    roughness: 0.9,
    metalness: 0.0,
    side: DoubleSide,
  });
  const flowerCenterMaterial = new MeshStandardMaterial({
    color: new Color(0xff7f00),
    emissive: new Color(0xcfaf33),
    roughness: 0.8,
    metalness: 0.0,
    side: DoubleSide,
  });
  const flowerPetalMaterial = new MeshStandardMaterial({
    color: new Color(0xffffff),
    emissive: new Color(0xaa7777),
    roughness: 0.8,
    metalness: 0.0,
    side: DoubleSide,
  });
  // const mat = new MeshNormalMaterial();

  // Instanced mesh
  const iMesh = new InstancedMesh(bladeGeom, grassMaterial, bladesPerTuft);
  iMesh.count = bladesPerTuft;
  iMesh.castShadow = true;
  iMesh.receiveShadow = true;
  iMesh.instanceMatrix.setUsage(DynamicDrawUsage); // DynamicDrawUsage

  // Compose transforms for each blade
  const tmpMat = new Matrix4();
  const tmpQuat = new Quaternion();
  const tmpScale = new Vector3();
  const tmpPos = new Vector3();

  for (let i = 0; i < bladesPerTuft; i++) {
    // Random position in a small disk (uniform)
    const r = tuftRadius * Math.sqrt(Math.random());
    const theta = Math.random() * Math.PI * 2;
    const px = Math.cos(theta) * r;
    const pz = Math.sin(theta) * r;

    // Height scale
    const h = bladeHeightRange[0] + Math.random() * (bladeHeightRange[1] - bladeHeightRange[0]);

    // Random yaw and slight tilt away from vertical
    const yaw = Math.random() * Math.PI * 2;
    const tilt = Math.random() * 0.2 - 0.1; // ~±0.1 rad tilt
    // Build quaternion: yaw around Y, then tilt around a random axis in XZ plane
    const axisX = Math.sin(yaw);
    const axisZ = Math.cos(yaw);
    tmpQuat.setFromAxisAngle(new Vector3(axisX, 0, axisZ), tilt);
    // Apply yaw after tilt for some variation
    const qYaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
    tmpQuat.multiply(qYaw);

    // Slight base width variance
    const width = 0.8 + Math.random() * 0.6;

    tmpScale.set(width, h, width);
    tmpPos.set(px, 0, pz);

    tmpMat.compose(tmpPos, tmpQuat, tmpScale);
    iMesh.setMatrixAt(i, tmpMat);
  }

  iMesh.instanceMatrix.needsUpdate = true;

  //

  const grassTuft = new Object3D();
  grassTuft.add(iMesh);
  const flowerCenter = new Mesh(new SphereGeometry(0.05, 16, 8), flowerCenterMaterial);
  flowerCenter.rotation.x = Math.PI * 0.125;
  flowerCenter.position.set(0, 0.35, 0);
  flowerCenter.scale.set(1, 0.1, 1);
  const flowerCenterBottom = new Mesh(new SphereGeometry(0.06, 16, 8), grassMaterial);
  flowerCenterBottom.position.set(0, -0.05, 0);
  flowerCenter.add(flowerCenterBottom);
  const flowerPetal = new Mesh(new SphereGeometry(0.03, 8, 4), flowerPetalMaterial);
  flowerPetal.scale.set(1, 0.2, 1);
  for (let i = 0; i < 9; i++) {
    const angle = (i / 9) * Math.PI * 2;
    const petal = flowerPetal.clone();
    petal.position.set(Math.cos(angle) * 0.06, 0.02, Math.sin(angle) * 0.06);
    flowerCenter.add(petal);
  }
  grassTuft.add(flowerCenter);

  return grassTuft;
}

export const getGrassTuft = Memoizer.makeMemoized(makeGrassTuft);
