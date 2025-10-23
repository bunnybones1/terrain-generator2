import { BufferAttribute, BufferGeometry } from "three";
import { PRNG } from "../../utils/PRNG";
import { createNoise3D } from "simplex-noise";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
import { makeIcoSphere } from "./makeIcoSphere";

// Build 5 LOD stone geosphere geometries with ridge-noise distortion and UVs set to x,z
export function buildStoneLODGeometries(baseRadius: number, rng: PRNG): BufferGeometry[] {
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
    const octaves = 4;
    const baseFreq = 0.16;
    const lacunarity = 2.1;
    const gain = 0.5;

    const ridge = (n: number) => {
      const a = 1 - Math.abs(n);
      return a * a;
    };

    for (let i = 0; i < attribPos.count; i++) {
      const x = attribPos.getX(i);
      const y = attribPos.getY(i);
      const z = attribPos.getZ(i);

      const r = Math.hypot(x, y, z) || 1;
      const nx = x / r;
      const ny = y / r;
      const nz = z / r;

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
      const push = 1.0 + centered * (pushAmt / Math.max(r, 1e-6));

      attribPos.setXYZ(i, nx * r * push, ny * r * push, nz * r * push);
    }
    attribPos.needsUpdate = true;

    // UVs from position x,z
    const count = attribPos.count;
    const uvs = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = attribPos.getX(i);
      const z = attribPos.getZ(i);
      uvs[i * 2 + 0] = x * 0.25;
      uvs[i * 2 + 1] = z * 0.25;
    }
    geom.setAttribute("uv", new BufferAttribute(uvs, 2));

    // Merge vertices to allow shared normals, then recompute normals for smooth shading
    const merged = BufferGeometryUtils.mergeVertices(geom);
    merged.computeVertexNormals();

    // replace original geometry's attributes with merged smooth version
    geom.setAttribute("position", merged.getAttribute("position"));
    if (merged.index) geom.setIndex(merged.index);
    geom.setAttribute("normal", merged.getAttribute("normal"));
    if (merged.getAttribute("uv")) geom.setAttribute("uv", merged.getAttribute("uv"));
    // ensure no flatShading flag on geometry
    // consumers should use material.flatShading=false for smooth shading
  };
  geos.forEach(distortAndUv);
  return geos;
}
