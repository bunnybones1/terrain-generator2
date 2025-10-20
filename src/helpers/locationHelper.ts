import { findIslandSpawn } from "../findIslandSpawn";
import FirstPersonController from "../FirstPersonController";
import { TerrainSampler } from "../terrain/TerrainSampler";

export function initLocationHelper(
  firstPersonController: FirstPersonController,
  terrainSampler: TerrainSampler
) {
  // URL utilities for camera position and angle (x, z, a)
  function getInitialXZAFromURL(): { x: number; z: number; a: number | null } | null {
    try {
      const params = new URLSearchParams(window.location.search);
      const xs = params.get("x");
      const zs = params.get("z");
      if (xs === null || zs === null) return null;
      const x = parseFloat(xs);
      const z = parseFloat(zs);
      if (!isFinite(x) || !isFinite(z)) return null;
      const as = params.get("a");
      let a: number | null = null;
      if (as !== null) {
        const av = parseFloat(as);
        if (isFinite(av)) a = av;
      }
      return { x, z, a };
    } catch {
      return null;
    }
  }

  function setXZAInURL(x: number, z: number, a: number | null | undefined) {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("x", x.toFixed(2));
      url.searchParams.set("z", z.toFixed(2));
      if (a !== null && a !== undefined && isFinite(a)) {
        url.searchParams.set("a", a.toFixed(3));
      } else {
        url.searchParams.delete("a");
      }
      window.history.replaceState({}, "", url.toString());
    } catch {
      // noop
    }
  }

  // Initialize from URL params or fallback to spawn
  const initialXZA = getInitialXZAFromURL();
  if (initialXZA) {
    const angle = initialXZA.a ?? 0;
    firstPersonController.setLocation(initialXZA.x, initialXZA.z, angle);
    // keep URL normalized
    setXZAInURL(initialXZA.x, initialXZA.z, angle);
  } else {
    // if no URL params, use spawn and seed URL
    const spawn = findIslandSpawn(terrainSampler.data, spawnSeed);
    firstPersonController.setLocation(spawn.x, spawn.z, spawn.angle);
    setXZAInURL(spawn.x, spawn.z, spawn.angle);
  }

  // Periodically write camera x,z,angle to URL every 4 seconds
  setInterval(() => {
    // Assuming FirstPersonController keeps yaw/angle accessible; fall back to 0 if not available
    const angle = firstPersonController.yaw;
    setXZAInURL(
      firstPersonController.camera.position.x,
      firstPersonController.camera.position.z,
      angle
    );
  }, 4000);
}
