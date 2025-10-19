import { createNoise3D } from "simplex-noise";
import { BufferGeometry, Vector3 } from "three";

// Remap spherical distribution into a right circular cone with height H and base radius R
export function sphereToCone(geom: BufferGeometry, height: number, baseRadius: number) {
  const pos = geom.getAttribute("position");
  if (!pos) return;
  const H = Math.max(1e-4, height);
  const R = Math.max(1e-4, baseRadius);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    // Direction on sphere
    const len = Math.hypot(x, y, z) || 1;
    const dx = x / len;
    const dy = y / len;
    const dz = z / len;

    // Map dy (-1..1) to cone height t in [0..1], bias so more points near base
    const t = Math.min(1, Math.max(0, dy * 0.5 + 0.5));
    const yCone = t * H;

    // Radius shrinks linearly toward tip: r(t) = R * (1 - t)
    const r = R * (1 - t);

    // Azimuth from direction in XZ
    const lenXZ = Math.hypot(dx, dz) || 1;
    const ux = dx / lenXZ;
    const uz = dz / lenXZ;

    const xCone = ux * r;
    const zCone = uz * r;

    pos.setXYZ(i, xCone, yCone - height * 0.5, zCone);
  }
  pos.needsUpdate = true;
  geom.computeVertexNormals();
}

// Apply multi-octave ridge noise displacement along vertex normals
export function distortAlongNormalWithRidge(
  geom: BufferGeometry,
  simplex: ReturnType<typeof createNoise3D>,
  amplitude: Vector3,
  frequency: number,
  octaves = 4,
  lacunarity = 2.0,
  gain = 0.5,
  bias = 0.5,
  yBias = 0
) {
  const pos = geom.getAttribute("position");
  const normal = geom.getAttribute("normal"); // may be missing initially
  if (!normal) {
    geom.computeVertexNormals();
  }
  const nAttr = geom.getAttribute("normal");
  if (!pos || !nAttr) return;

  const ridge = (n: number) => {
    const a = 1 - Math.abs(n);
    return a * a;
  };

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    // Sample ridge multi-octave noise in object space
    let f = frequency;
    let a = 1.0;
    let sum = 0;
    let ampSum = 0;
    for (let o = 0; o < octaves; o++) {
      const n = simplex(x * f, y * f, z * f); // -1..1
      const r = ridge(n); // 0..1
      sum += r * a;
      ampSum += a;
      f *= lacunarity;
      a *= gain;
    }
    const fbm = ampSum > 0 ? sum / ampSum : 0;

    const xzLen = Math.hypot(x, z) * 0.5;

    const nx = nAttr.getX(i) * xzLen;
    const ny = nAttr.getY(i) * xzLen + yBias;
    const nz = nAttr.getZ(i) * xzLen;

    const push = fbm - bias;
    pos.setXYZ(
      i,
      x + nx * amplitude.x * push,
      y + ny * amplitude.y * push,
      z + nz * amplitude.z * push
    );
  }
  pos.needsUpdate = true;
  geom.computeVertexNormals();
}
