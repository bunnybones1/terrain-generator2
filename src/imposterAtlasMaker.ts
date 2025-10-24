import {
  AmbientLight,
  Color,
  DirectionalLight,
  NearestFilter,
  // NearestMipmapNearestFilter,
  Object3D,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Texture,
  WebGLRenderer,
  WebGLRenderTarget,
} from "three";

// Build an atlas texture by rendering the tuft from a dome of angles
export function buildImposterAtlas(
  item: Object3D,
  renderer: WebGLRenderer,
  options?: {
    tileResolution?: number;
    stepsYaw?: number; // around Y
    stepsPitch?: number; // from horizon to top
    fov?: number;
    radius?: number;
    clearColor?: number;
  }
): Texture {
  const tile = options?.tileResolution ?? 128;
  const stepsYaw = options?.stepsYaw ?? 8;
  const stepsPitch = options?.stepsPitch ?? 8;
  const fov = options?.fov ?? 25;
  const radius = options?.radius ?? 1.25;
  const clearColor = options?.clearColor ?? 0x000000;

  const width = stepsYaw * tile;
  const height = stepsPitch * tile;

  // Create target
  const target = new WebGLRenderTarget(width, height, {
    depthBuffer: true,
    stencilBuffer: false,
    colorSpace: SRGBColorSpace,
    magFilter: NearestFilter,
    minFilter: NearestFilter,
    // magFilter: NearestFilter,
    // minFilter: NearestMipmapNearestFilter,
    // generateMipmaps: true,
  });

  // Scene setup
  const scene = new Scene();
  scene.add(item);

  // Simple lighting: ambient + directional
  const amb = new AmbientLight(0xffffff, 1.6);
  const dir = new DirectionalLight(0xffffff, 2.8);
  dir.position.set(2, 4, 2);
  scene.add(amb, dir);

  // Camera
  const cam = new PerspectiveCamera(fov, 1, 0.01, 10);
  cam.up.set(0, 1, 0);

  const oldTarget = renderer.getRenderTarget();
  const oldClearColor = renderer.getClearColor(new Color());
  const oldClearAlpha = renderer.getClearAlpha();
  // const oldViewport = renderer.getViewport(new (renderer as any).domElement.ownerDocument.defaultView.THREE.Vector4?.constructor?.() || undefined);

  renderer.setClearColor(clearColor, 0); // transparent background
  renderer.setRenderTarget(target);
  renderer.clear(true, true, true);

  // Dome: pitch from 0 (horizon) to 90 deg (top)
  for (let py = 0; py < stepsPitch; py++) {
    const tPitch = stepsPitch <= 1 ? 1 : py / (stepsPitch - 1);
    const pitch = (tPitch * Math.PI) / 2; // 0..PI/2
    for (let y = 0; y < stepsYaw; y++) {
      const tYaw = y / stepsYaw;
      const yaw = tYaw * Math.PI * 2;

      // Spherical to Cartesian: radius, pitch (elevation), yaw (azimuth)
      const sx = Math.cos(pitch) * Math.sin(yaw);
      const sy = Math.sin(pitch);
      const sz = Math.cos(pitch) * Math.cos(yaw);

      cam.position.set(sx * radius, sy * radius, sz * radius);
      cam.lookAt(0, 0, 0); // look at tuft center slightly above base
      cam.updateMatrixWorld();

      // set viewport for tile
      const vx = y * tile;
      const vy = py * tile;
      renderer.setViewport(vx, vy, tile, tile);

      // keep square aspect
      cam.aspect = 1;
      cam.updateProjectionMatrix();

      renderer.render(scene, cam);
    }
  }

  // restore renderer state
  renderer.setViewport(0, 0, width, height); // reset to full target
  renderer.setRenderTarget(oldTarget);
  renderer.setClearColor(oldClearColor, oldClearAlpha);

  return target.texture;
}
