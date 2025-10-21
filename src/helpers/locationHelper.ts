import { findIslandSpawn } from "../findIslandSpawn";
import FirstPersonController from "../FirstPersonController";
import { TerrainSampler } from "../terrain/TerrainSampler";

const SPAWN_SEED = 2;

export function initLocationHelper(
  firstPersonController: FirstPersonController,
  terrainSampler: TerrainSampler
) {
  // URL utilities for camera position, angle, and flying flag (x, y, z, a, f)
  function getInitialXYZAFFromURL(): {
    x: number;
    y: number;
    z: number;
    a: number;
    f: boolean | null;
  } | null {
    try {
      const params = new URLSearchParams(window.location.search);
      const xs = params.get("x");
      const ys = params.get("y");
      const zs = params.get("z");
      const ans = params.get("a");
      if (xs === null || ys === null || zs === null || ans === null) return null;
      const x = parseFloat(xs);
      const y = parseFloat(ys);
      const z = parseFloat(zs);
      const a = parseFloat(ans);
      if (!isFinite(x) || !isFinite(y) || !isFinite(z) || !isFinite(a)) return null;

      let f: boolean | null = null;
      const fs = params.get("f");
      if (fs !== null) {
        f = fs === "1" || fs.toLowerCase() === "true";
      }

      return { x, y, z, a, f };
    } catch {
      return null;
    }
  }

  function setXYZAFInURL(
    x: number,
    y: number,
    z: number,
    a: number,
    f: boolean | null | undefined
  ) {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("x", x.toFixed(2));
      url.searchParams.set("y", y.toFixed(2));
      url.searchParams.set("z", z.toFixed(2));
      url.searchParams.set("a", a.toFixed(2));
      if (f !== null && f !== undefined) {
        url.searchParams.set("f", f ? "1" : "0");
      } else {
        url.searchParams.delete("f");
      }
      window.history.replaceState({}, "", url.toString());
    } catch {
      // noop
    }
  }

  // Initialize from URL params or fallback to spawn
  const initialXYZAf = getInitialXYZAFFromURL();
  if (initialXYZAf) {
    // Set XZ via controller API; then override Y on camera
    firstPersonController.setLocation(
      initialXYZAf.x,
      initialXYZAf.y,
      initialXYZAf.z,
      initialXYZAf.a,
      !!initialXYZAf.f
    );

    // keep URL normalized
    setXYZAFInURL(
      initialXYZAf.x,
      initialXYZAf.y,
      initialXYZAf.z,
      initialXYZAf.a,
      firstPersonController.isFlying ?? undefined
    );
  } else {
    // if no URL params, use spawn and seed URL
    const spawn = findIslandSpawn(terrainSampler.data, SPAWN_SEED);
    firstPersonController.setLocation(spawn.x, 0, spawn.z, spawn.angle, false);
    setXYZAFInURL(
      spawn.x,
      firstPersonController.camera.position.y,
      spawn.z,
      spawn.angle,
      firstPersonController.isFlying
    );
  }

  // Periodically write camera x,y,z,angle,flying to URL every 4 seconds
  setInterval(() => {
    // Assuming FirstPersonController keeps yaw/angle accessible; fall back to 0 if not available
    const angle = firstPersonController.yaw;
    setXYZAFInURL(
      firstPersonController.camera.position.x,
      firstPersonController.camera.position.y,
      firstPersonController.camera.position.z,
      angle,
      firstPersonController.isFlying
    );
  }, 4000);
}
