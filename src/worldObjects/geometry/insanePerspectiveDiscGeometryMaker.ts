import { ConeGeometry, Matrix4 } from "three";
import { lerp } from "../../utils/math";

export function makeInsanePerspectiveDiscGeometry(size: number) {
  const geometry = new ConeGeometry(1, 0, 16, 12);
  // Square every vertex coordinate (x,y,z) in the geometry
  {
    const posAttr = geometry.getAttribute("position");
    const uvAttr = geometry.getAttribute("uv");
    if (posAttr && posAttr.array) {
      const arr = posAttr.array as Float32Array;
      const arrUv = uvAttr.array as Float32Array;
      // Scale vertex length (radially) while preserving direction
      for (let i = 0; i < posAttr.count; i++) {
        const i2 = i * 2;
        const i3 = i * 3;
        const x = arr[i3];
        const y = arr[i3 + 1];
        const z = arr[i3 + 2];
        const r = Math.hypot(x, y, z);
        if (r > 0) {
          // Choose a powering behavior for radius; stronger push at larger radii
          const k = lerp(3.8, 6, Math.min(1, r)); // reuse existing intent
          const r2 = Math.pow(r, k);
          const s = r2 / r;
          arr[i3] = x * s;
          arr[i3 + 1] = y * s;
          arr[i3 + 2] = z * s;
        }
        arrUv[i2] = arr[i3];
        arrUv[i2 + 1] = arr[i3 + 2];
      }
      posAttr.needsUpdate = true;
      uvAttr.needsUpdate = true;
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      geometry.computeBoundingBox();
    }
  }
  // Scale and rotate water geometry via matrix (scale to size, rotate 90deg on X)
  const transform = new Matrix4()
    .makeScale(size, size, size)
    .multiply(new Matrix4().makeRotationX(Math.PI / 2));
  geometry.applyMatrix4(transform);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}
