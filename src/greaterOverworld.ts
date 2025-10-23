import {
  Color,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  Mesh,
  SphereGeometry,
  MeshStandardMaterial,
} from "three";
import Water from "./worldObjects/Water";
import { OVERDRAW_TEST, SUN_SHADOW_SCALE } from "./overrides";
import Sky from "./worldObjects/Sky";
import { easeInOut, remapClamp } from "./utils/math";
import {
  cloudColor,
  sunColor,
  sunColorForEnvMap,
  worldColorBottom,
  worldColorBottomDefault,
  worldColorTop,
} from "./gameColors";
import { auroraScroll, auroraStrength, cloudScroll, worldTime, sunVector } from "./sharedGameData";
import { waterColor, waterColorDefault } from "./sharedWaterShaderControls";
// import { findIslandSpawn } from "./findIslandSpawn";

export function initGreaterOverworld(
  scene: Scene,
  camera: PerspectiveCamera,
  renderer: WebGLRenderer,
  terrainMat: MeshStandardMaterial,
  skyMaker: Sky
) {
  // Sky color remap: define breakpoints (sun Y) and corresponding colors, ascending by Y
  // You can tweak these points to shape your sunrise/sunset transitions
  const remapPoints: number[] = [
    -0.1, // deep night
    0, // pre-dawn purple
    0.1, // red
    0.2, // orange
    0.3, // daytime ramp
    1.0, // high noon
  ];

  const skyColors: Color[] = [
    new Color(0.003, 0.01, 0.03), // night
    new Color(0.5, 0.1, 0.8), // purple
    new Color(1.1, 0.15, 0.1), // red
    new Color(1.2, 0.9, 0.15), // orange
    new Color(0.35, 0.6, 1.0), // day blue ramp
    new Color(0.35, 0.6, 1.0), // high noon (same as day blue)
  ];

  const sunColors: Color[] = [
    new Color(0, 0, 0), // night
    new Color(600, 0, 0), // purple
    new Color(1000, 200, 0), // red
    new Color(1000, 900, 0), // orange
    new Color(1000, 900, 600), // day blue ramp
    new Color(1000, 900, 600), // high noon (same as day blue)
  ];

  const cloudColors: Color[] = [
    new Color(0.005, 0.025, 0.05), // night
    new Color(0.6, 0.1, 0.1), // red
    new Color(0.6, 0.3, 0.15), // orange
    new Color(0.35, 0.3, 0.3),
    new Color(0.6, 0.6, 0.6),
    new Color(0.6, 0.6, 0.6),
  ];

  const tmp = new Color();
  // Helper: given sunY in [-1,1], return blended color from closest two remap points
  function getColorFromSunY(colors: Color[], y: number): Color {
    // Clamp y to domain
    const yy = Math.max(remapPoints[0], Math.min(remapPoints[remapPoints.length - 1], y));
    // Find bracket
    let i1 = 0;
    for (let i = 1; i < remapPoints.length; i++) {
      if (yy <= remapPoints[i]) {
        i1 = i;
        break;
      }
      i1 = i;
    }
    const i0 = Math.max(0, i1 - 1);
    const x0 = remapPoints[i0];
    const x1 = remapPoints[i1];
    const c0 = colors[i0];
    const c1 = colors[i1];
    // Avoid divide by zero if duplicate points
    const t = x1 !== x0 ? (yy - x0) / (x1 - x0) : 0;
    tmp.copy(c0).lerp(c1, Math.max(0, Math.min(1, t)));
    return tmp;
  }
  const skyForScene = skyMaker.createVisuals(true);
  skyForScene.root.scale.multiplyScalar(10000);

  const sunLight = new DirectionalLight(0xffeebb, 1.5);
  sunLight.castShadow = true;

  // Ocean plane at y = 0 (follows camera in x/z)
  // const oceanSize = 40000; // meters
  // const oceanGeom = new PlaneGeometry(oceanSize, oceanSize, 40, 40);
  // oceanGeom.rotateX(-Math.PI / 2); // make it horizontal
  const oceanManager = new Water(camera);
  const ocean = oceanManager.visuals;
  // ocean.position.set(0, 0, 0);
  // ocean.castShadow = false;
  // ocean.receiveShadow = true;

  if (OVERDRAW_TEST) {
    scene.background = new Color(0x000000);
  } else {
    scene.add(skyForScene.root);
    // scene.background = envMap.texture;
  }

  scene.add(ocean);
  scene.add(oceanManager.refractor);

  // Configure shadow properties for better quality
  sunLight.shadow.mapSize.width = 4096;
  sunLight.shadow.mapSize.height = 4096;
  sunLight.shadow.camera.near = 0;
  sunLight.shadow.camera.far = SUN_SHADOW_SCALE * 4;
  sunLight.shadow.bias = 0.0001;

  // Center shadow camera around the camera for consistent coverage
  const cam = sunLight.shadow.camera;
  const range = SUN_SHADOW_SCALE;
  cam.left = -range;
  cam.right = range;
  cam.top = range;
  cam.bottom = -range;
  cam.updateProjectionMatrix();

  // Initialize position; will be updated each frame
  sunLight.position.set(0, 30, 0);

  scene.add(sunLight);

  // Huge inverted half-sphere (faces point inward) that will follow camera X/Z
  const waterSphereGeom = new SphereGeometry(99000, 64, 16, 0, Math.PI * 2, Math.PI * 0.5, Math.PI);

  // Reverse face indices (triangle winding) and flip normals so faces point inward
  if (waterSphereGeom.index) {
    const idx = waterSphereGeom.index.array as Uint16Array | Uint32Array;
    for (let i = 0; i < idx.length; i += 3) {
      // swap second and third index to reverse winding
      const tmp = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = tmp;
    }
    waterSphereGeom.index.needsUpdate = true;
  }
  // Invert normals
  const normalAttr = waterSphereGeom.getAttribute("normal");
  for (let i = 0; i < normalAttr.count; i++) {
    normalAttr.setX(i, -normalAttr.getX(i));
    normalAttr.setY(i, -normalAttr.getY(i));
    normalAttr.setZ(i, -normalAttr.getZ(i));
  }
  normalAttr.needsUpdate = true;
  // Update bounds after modifications
  waterSphereGeom.computeBoundingSphere();
  waterSphereGeom.computeBoundingBox();

  const waterSphere = new Mesh(waterSphereGeom, terrainMat);
  waterSphere.name = "InvertedFollowSphere";
  waterSphere.frustumCulled = false;
  waterSphere.renderOrder = 10;
  waterSphere.position.set(0, 0, 0);
  scene.add(waterSphere);

  function update() {
    // Animate sun vector around Z axis and update background env
    {
      cloudScroll.x = (camera.position.x * 40) / 100000 + worldTime.value * 3;
      cloudScroll.y = (camera.position.z * 40) / -100000;
      cloudScroll.z = worldTime.value * 3;
      auroraScroll.x = (camera.position.x * 40) / 100000;
      auroraScroll.y = (camera.position.z * 40) / -100000;
      auroraScroll.z = worldTime.value * 10;
      auroraStrength.value = 1.0 - remapClamp(-0.3, -0.1, Math.sin(worldTime.value));

      sunVector.set(Math.cos(worldTime.value), Math.sin(worldTime.value), 0);

      skyMaker.update();

      // Animate world colors via remap points and weighted blend of closest two
      {
        const y = Math.max(-1, Math.min(1, sunVector.clone().normalize().y));
        worldColorTop.copy(getColorFromSunY(skyColors, y));
        cloudColor.copy(getColorFromSunY(cloudColors, y));
        sunColor.copy(getColorFromSunY(sunColors, y));

        sunLight.color
          .copy(sunColor)
          .multiplyScalar(0.0015)
          .multiplyScalar(easeInOut(remapClamp(-0.03, 0.005, y)));

        sunColorForEnvMap.copy(sunColor).multiplyScalar(0.02);

        // Update water color: copy default and modulate by sun color (normalized to [0..1] range)
        tmp.copy(sunColor).multiplyScalar(1.0 / 1000.0); // normalize large sun color
        tmp.multiplyScalar(0.95).addScalar(0.05);
        waterColor.copy(waterColorDefault).multiply(tmp);

        // Apply to hemisphere material top color
        worldColorBottom.copy(worldColorBottomDefault).multiply(sunColor).multiplyScalar(0.0015);
        // groundSkyAmbientMat.uniformsNeedUpdate = true;
      }
    }

    // Make dirLight follow the camera
    {
      const offset = sunVector.clone().multiplyScalar(SUN_SHADOW_SCALE * 2);
      sunLight.position.copy(camera.position).add(offset);
      sunLight.target.position.copy(camera.position);
      sunLight.updateMatrixWorld();
      sunLight.target.updateMatrixWorld();
      sunLight.shadow.camera.updateMatrixWorld();

      // Center shadow camera around the camera for consistent coverage
      const cam = sunLight.shadow.camera;
      const range = SUN_SHADOW_SCALE;
      cam.left = -range;
      cam.right = range;
      cam.top = range;
      cam.bottom = -range;
      cam.updateProjectionMatrix();
    }
    // Make inverted sphere follow the camera X/Z (keep Y fixed so horizon stays stable)
    waterSphere.position.x = camera.position.x;
    waterSphere.position.z = camera.position.z;
    skyForScene.root.position.x = camera.position.x;
    skyForScene.root.position.z = camera.position.z;
    skyForScene.root.updateMatrixWorld();

    // Optionally also follow Y if desired:
    // skySphere.position.y = camera.position.y;

    oceanManager.update();
  }
  return {
    update,
  };
}
