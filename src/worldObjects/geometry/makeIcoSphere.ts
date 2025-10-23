import { IcosahedronGeometry } from "three";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";

export function makeIcoSphere(baseRadius: number, detail: number) {
  const geom = new IcosahedronGeometry(baseRadius, Math.pow(2, detail));
  const attribPos = geom.getAttribute("position");
  const attribNormal = geom.getAttribute("normal");
  const attribUv = geom.getAttribute("uv");

  for (let i = 0; i < attribPos.count; i++) {
    const x = attribPos.getX(i);
    const y = attribPos.getY(i);
    const z = attribPos.getZ(i);

    const r = Math.hypot(x, y, z) || 1;
    const nx = x / r;
    const ny = y / r;
    const nz = z / r;

    const u = x * 0.25;
    const v = z * 0.25;

    attribPos.setXYZ(i, x, y, z);
    attribNormal.setXYZ(i, nx, ny, nz);
    attribUv.setXY(i, u, v);
  }

  attribPos.needsUpdate = true;
  attribNormal.needsUpdate = true;
  attribUv.needsUpdate = true;

  const merged = BufferGeometryUtils.mergeVertices(geom);
  merged.computeVertexNormals();

  return merged;
}
