import { BufferGeometry, Matrix4 } from "three";
import { PRNG } from "../../utils/PRNG";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
import { createNoise3D } from "simplex-noise";
import { makeTreeTrunk } from "./tree-trunk";
import { makePineFoliage } from "./pine-foliage";

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
    const segs = Math.max(6, 16 - i * 3);
    const trunkRadius = Math.max(0.05, baseRadius * 0.15);
    const trunkHeight = baseHeight * 0.45;
    const foliageHeight = baseHeight - trunkHeight;
    const trunk = makeTreeTrunk(trunkRadius, trunkHeight, segs, simplex);
    const accumulated = trunkHeight;

    const cone = makePineFoliage(baseRadius, foliageHeight, segs, simplex);

    const cMat = new Matrix4().makeTranslation(0, accumulated + foliageHeight * 0.5, 0);
    cone.applyMatrix4(cMat);

    const merged = BufferGeometryUtils.mergeGeometries([trunk, cone], true);

    geos.push(merged);
  }
  return geos;
}
