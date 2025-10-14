import { Memoizer } from "memoizer-ts";
import type { BufferGeometry } from "three";
import { PlaneGeometry } from "three";

export function createPlaneGeometry(
  width: number,
  height: number,
  segsU = 1,
  segsV = 1
): BufferGeometry {
  const geometry = new PlaneGeometry(width, height, segsU, segsV);
  return geometry;
}

export const getPlaneGeometry = Memoizer.makeMemoized(createPlaneGeometry);
