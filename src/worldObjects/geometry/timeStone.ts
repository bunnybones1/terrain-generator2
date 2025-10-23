import { BufferGeometry } from "three";
import { PRNG } from "../../utils/PRNG";
import { createNoise3D } from "simplex-noise";
import { makeIcoSphere } from "./makeIcoSphere";

// Build 5 LOD time stone geosphere geometries with ridge-noise distortion and UVs set to x,z
export function buildTimeStoneLODGeometries(baseRadius: number, rng: PRNG): BufferGeometry[] {
  // Map a target "segments" to icosahedron detail level
  const targetSegments = Math.max(4, Math.ceil(2 * Math.PI * Math.max(baseRadius, 0.01) * 12));
  const detailForSegments = (segments: number) => {
    if (segments >= 256) return 4;
    if (segments >= 128) return 3;
    if (segments >= 64) return 2;
    if (segments >= 32) return 1;
    return 0;
  };
  const baseDetail = detailForSegments(targetSegments);

  const levels = 5;
  const geos: BufferGeometry[] = [];
  for (let i = 0; i < levels; i++) {
    const detail = Math.max(0, baseDetail - i); // reduce detail each LOD
    geos.push(makeIcoSphere(baseRadius, detail));
  }

  const simplex = createNoise3D(rng.next);
  const distortAndUv = (geom: BufferGeometry) => {
    const attribPos = geom.getAttribute("position");
    const attribNormal = geom.getAttribute("normal");
    const attribUv = geom.getAttribute("uv");

    const octaves = 4;
    const baseFreq = 0.46;
    const lacunarity = 1.75;
    const gain = 0.65;

    const ridge = (n: number) => {
      const a = 1 - Math.abs(n);
      return a * a;
    };

    for (let i = 0; i < attribPos.count; i++) {
      const x = attribPos.getX(i);
      const y = attribPos.getY(i) * 3;
      const z = attribPos.getZ(i);

      const nx = attribNormal.getX(i);
      const ny = attribNormal.getY(i);
      const nz = attribNormal.getZ(i);

      let f = baseFreq;
      let a = 1.0;
      let sum = 0;
      let ampSum = 0;
      for (let o = 0; o < octaves; o++) {
        const n = simplex(nx * f, ny * f, nz * f); // -1..1
        const ridged = ridge(n); // 0..1
        sum += ridged * a;
        ampSum += a;
        f *= lacunarity;
        a *= gain;
      }
      const fbm = ampSum > 0 ? sum / ampSum : 0;

      const centered = fbm - 0.5;
      const pushAmt = baseRadius * 0.75;
      const push = centered * pushAmt;

      const x2 = x + nx * push;
      const y2 = y + ny * push;
      const z2 = z + nz * push;

      attribPos.setXYZ(i, x2, y2, z2);
      attribUv.setXY(i, x2, z2);
    }
    attribPos.needsUpdate = true;
    attribNormal.needsUpdate = true;
    attribUv.needsUpdate = true;
  };
  geos.forEach(distortAndUv);
  return geos;
}
