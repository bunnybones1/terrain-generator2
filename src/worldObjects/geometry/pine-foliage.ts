import { BufferAttribute, IcosahedronGeometry, Vector3 } from "three/src/Three.Core.js";

import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
import { distortAlongNormalWithRidge, sphereToCone } from "../../utils/geometry";
import { createNoise3D } from "simplex-noise";
import { remapClamp } from "../../utils/math";

export function makePineFoliage(
  radius: number,
  height: number,
  segs: number,
  simplex: ReturnType<typeof createNoise3D>
) {
  // Foliage: stack cones
  const icoSphere = new IcosahedronGeometry(radius, segs);

  //recalculate UVs for icosphere before merging to prevent seams
  const cPos = icoSphere.getAttribute("position");
  const cuvs = new Float32Array(cPos.count * 2);
  for (let vi = 0; vi < cPos.count; vi++) {
    cuvs[vi * 2 + 0] = cPos.getX(vi) * 0.1;
    cuvs[vi * 2 + 1] = cPos.getZ(vi) * 0.1;
  }
  icoSphere.setAttribute("uv", new BufferAttribute(cuvs, 2));
  // Remap spherical vertices into a cone of given height and base radius
  const cone = BufferGeometryUtils.mergeVertices(icoSphere, 0.01);
  // Initialize cone invAOAndMask right after merge: x = vertex Y, y = mask=1
  {
    const cPos0 = cone.getAttribute("position") as BufferAttribute;
    const arr = new Float32Array(cPos0.count * 2);
    for (let vi = 0; vi < cPos0.count; vi++) {
      arr[vi * 2 + 0] = remapClamp(-radius * 0.99, -radius, cPos0.getY(vi)) * 0.75; // invAO from current Y
      arr[vi * 2 + 1] = 1.0; // mask = 1 for cones
    }
    cone.setAttribute("invAOAndMask", new BufferAttribute(arr, 2));
    cone.setAttribute("pine", new BufferAttribute(new Float32Array(cPos0.count).fill(1), 1));
  }
  sphereToCone(cone, height, radius);
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

  // Add organic irregularity to foliage by pushing along normals using ridge fbm
  // amplitude scaled by local radius/height to keep proportions across LODs
  const amp = Math.max(0.02, radius * 0.5) * 10;
  const freq = (0.4 / Math.max(0.5, radius)) * 4;
  distortAlongNormalWithRidge(
    cone,
    simplex,
    new Vector3(amp, amp * 0.5, amp),
    freq,
    4,
    2.1,
    0.55,
    0.25,
    -0.2
  );

  return cone;
}
