import { Memoizer } from "memoizer-ts";
import type { BufferGeometry } from "three";
import { SphereGeometry } from "three";

export function createSphereGeometry(
  radius?: number,
  widthSegments?: number,
  heightSegments?: number,
  phiStart?: number,
  phiLength?: number,
  thetaStart?: number,
  thetaLength?: number
): BufferGeometry {
  const geometry = new SphereGeometry(
    radius,
    widthSegments,
    heightSegments,
    phiStart,
    phiLength,
    thetaStart,
    thetaLength
  );
  return geometry;
}

export const getSphereGeometry = Memoizer.makeMemoized(createSphereGeometry);
