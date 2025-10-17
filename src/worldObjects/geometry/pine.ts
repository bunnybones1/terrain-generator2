import {
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  Matrix4,
} from "three";
import { PRNG } from "../../utils/PRNG";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
import { createNoise3D } from "simplex-noise";

// Remap spherical distribution into a right circular cone with height H and base radius R
function sphereToCone(geom: BufferGeometry, height: number, baseRadius: number) {
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
function distortAlongNormalWithRidge(
  geom: BufferGeometry,
  simplex: ReturnType<typeof createNoise3D>,
  amplitude: number,
  frequency: number,
  octaves = 4,
  lacunarity = 2.0,
  gain = 0.5
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
    const ny = nAttr.getY(i) * xzLen;
    const nz = nAttr.getZ(i) * xzLen;

    const push = amplitude * (fbm - 0.5);
    pos.setXYZ(i, x + nx * push, y + ny * push, z + nz * push);
  }
  pos.needsUpdate = true;
  geom.computeVertexNormals();
}

// Build simple pine tree geometries across LODs (trunk + 1-3 cones for foliage)
// Returns merged BufferGeometries usable for instancing.
export function buildPineLODGeometries(
  baseHeight: number,
  baseRadius: number,
  rng: PRNG
): BufferGeometry[] {
  const levels = 5;
  const simplex = createNoise3D(rng.next);
  const geos: BufferGeometry[] = [];
  for (let i = 0; i < levels; i++) {
    // progressively coarser with fewer foliage sections
    const segs = Math.max(6, 16 - i * 3);
    const trunkRadius = Math.max(0.05, baseRadius * 0.15);
    const trunkHeight = baseHeight * 0.4;
    const foliageHeight = baseHeight - trunkHeight;

    // Trunk
    const trunk = new CylinderGeometry(trunkRadius * 0.8, trunkRadius, trunkHeight, segs, 1, true);
    const tMat = new Matrix4().makeTranslation(0, trunkHeight * 0.5, 0);
    trunk.applyMatrix4(tMat);
    {
      const tuv = trunk.getAttribute("uv") as BufferAttribute | undefined;
      if (tuv) {
        const arr = tuv.array as Float32Array;
        for (let i = 0; i < tuv.count; i++) {
          arr[i * 2 + 0] *= 12.0; // scale U
          arr[i * 2 + 1] *= 4.0; // scale V
        }
        tuv.needsUpdate = true;
      }
    }

    // Foliage: stack cones
    const foliageParts: BufferGeometry[] = [];
    let accumulated = trunkHeight;
    const sectionHeight = foliageHeight;
    const top = accumulated + sectionHeight;
    const baseR = baseRadius;
    const icoSphere = new IcosahedronGeometry(baseR, segs);

    //recalculate UVs for icosphere before merging to prevent seams
    const cPos = icoSphere.getAttribute("position");
    const cuvs = new Float32Array(cPos.count * 2);
    for (let vi = 0; vi < cPos.count; vi++) {
      cuvs[vi * 2 + 0] = cPos.getX(vi) * 0.1;
      cuvs[vi * 2 + 1] = cPos.getZ(vi) * 0.1;
    }
    icoSphere.setAttribute("uv", new BufferAttribute(cuvs, 2));

    const cone = BufferGeometryUtils.mergeVertices(icoSphere, 0.01);
    // Remap spherical vertices into a cone of given height and base radius
    sphereToCone(cone, sectionHeight, baseR);
    // Add organic irregularity to foliage by pushing along normals using ridge fbm
    // amplitude scaled by local radius/height to keep proportions across LODs
    const amp = Math.max(0.02, baseR * 0.5) * 10;
    const freq = (0.4 / Math.max(0.5, baseR)) * 4;
    distortAlongNormalWithRidge(cone, simplex, amp, freq, 4, 2.1, 0.55);

    const cMat = new Matrix4().makeTranslation(0, accumulated + sectionHeight * 0.5, 0);
    cone.applyMatrix4(cMat);

    // UVs for cone from x,z scaled (tiling)
    {
      const cPos = cone.getAttribute("position");
      const cuvs = new Float32Array(cPos.count * 2);
      for (let vi = 0; vi < cPos.count; vi++) {
        cuvs[vi * 2 + 0] = cPos.getX(vi);
        cuvs[vi * 2 + 1] = cPos.getZ(vi);
      }
      cone.setAttribute("uv", new BufferAttribute(cuvs, 2));
    }

    foliageParts.push(cone);

    accumulated = top;

    // Build 'pine' attribute arrays matching each sub-geometry before merge
    const pineAttrs: BufferAttribute[] = [];
    const trunkPos = trunk.getAttribute("position");
    pineAttrs.push(new BufferAttribute(new Float32Array(trunkPos.count).fill(0), 1));
    for (const cone of foliageParts) {
      const conePos = cone.getAttribute("position");
      pineAttrs.push(new BufferAttribute(new Float32Array(conePos.count).fill(1), 1));
    }

    // Attach attributes to sub-geometries so mergeGeometries merges them
    trunk.setAttribute("pine", pineAttrs[0]);
    for (let idx = 0; idx < foliageParts.length; idx++) {
      foliageParts[idx].setAttribute("pine", pineAttrs[idx + 1]);
    }

    const merged = BufferGeometryUtils.mergeGeometries([trunk, ...foliageParts], true);

    // UVs are provided per-part (trunk and cones) before merge so they carry through.
    // 'pine' attribute is already carried over by mergeGeometries
    merged.computeVertexNormals();
    geos.push(merged);
  }
  return geos;
}
