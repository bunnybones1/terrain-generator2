import { TerrainData } from "./terrain/TerrainData";
import { PRNG } from "./utils/PRNG";

// Find a shoreline spawn: first find a land point (h>0), then leap outward until (h<0), then binary search to h≈0
export function findIslandSpawn(
  terrainData: TerrainData,
  seed: number,
  maxAttempts = 1500
): { x: number; z: number; angle: number } {
  const prng = new PRNG(seed);
  const rng = prng.next;

  // 1) Find a land point with growing jumps
  let jump = 512;
  let angle = rng() * Math.PI * 2; // random angle
  let landX = 0,
    landZ = 0,
    hLand = -Infinity;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt % 8 === 0 && attempt > 0) {
      jump *= 2;
    }
    angle += Math.PI * 2 * 0.38196601125; // golden angle
    const r = jump * (0.5 + rng()); // random within band
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const h = terrainData.getHeight(x, z);
    if (h > 0) {
      landX = x;
      landZ = z;
      hLand = h;
      break;
    }
  }
  if (!(hLand > 0)) {
    // default direction facing outward from origin
    return { x: 0, z: 0, angle };
  }

  // 2) From land point, leap outward along the same angle until we find ocean (h<0)
  let seaX = landX,
    seaZ = landZ,
    hSea = hLand;
  let step = 256;
  let tries = 0;
  while (tries < 256) {
    tries++;
    step *= 1.5;
    const x = landX + Math.cos(angle) * step;
    const z = landZ + Math.sin(angle) * step;
    const h = terrainData.getHeight(x, z);
    if (h < 0) {
      seaX = x;
      seaZ = z;
      hSea = h;
      break;
    }
  }
  // If we failed to find ocean, just return land point
  if (!(hSea < 0)) {
    return { x: landX, z: landZ, angle };
  }

  // 3) Binary search between land (h>0) and sea (h<0) for h≈0
  let ax = landX,
    az = landZ;
  // ah = hLand;
  let bx = seaX,
    bz = seaZ;
  // bh = hSea;
  for (let i = 0; i < 48; i++) {
    const mx = (ax + bx) * 0.5;
    const mz = (az + bz) * 0.5;
    const mh = terrainData.getHeight(mx, mz);
    if (mh > 0) {
      ax = mx;
      az = mz;
      // ah = mh;
    } else {
      bx = mx;
      bz = mz;
      // bh = mh;
    }
    // early exit if very close to 0
    if (Math.abs(mh) < 1e-3) {
      ax = bx = mx;
      az = bz = mz;
      break;
    }
  }
  const sx = (ax + bx) * 0.5;
  const sz = (az + bz) * 0.5;

  // Direction from land toward sea is along 'angle'

  return { x: sx, z: sz, angle };
}
