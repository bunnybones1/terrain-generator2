import {
  Color,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  Mesh,
  CircleGeometry,
  SphereGeometry,
  PMREMGenerator,
  DoubleSide,
  MeshBasicMaterial,
  PlaneGeometry,
  HemisphereLight,
} from "three";
import { TerrainRenderer } from "./terrain/TerrainRenderer";
import { TerrainData } from "./terrain/TerrainData";
import { TerrainQuadtree } from "./terrain/TerrainQuadtree";
import { TerrainSampler } from "./terrain/TerrainSampler";
import FirstPersonController from "./FirstPersonController";
import Water from "./worldObjects/Water";
import { uniformTime } from "./worldObjects/materials/globalUniforms/time";
import CloudPlaneMaterial from "./worldObjects/materials/CloudPlaneMaterial";
import { getPlaneGeometry } from "./worldObjects/geometry/planeGeometry";
import HemisphereAmbientMaterial from "./worldObjects/materials/HemisphereAmbientMaterial";
import { getSphereGeometry } from "./worldObjects/geometry/sphereGeometry";
import { ProbeManager } from "./lighting/ProbeManager";
import { makeTerrainMaterial } from "./terrain/materials";
import { logTime } from "./utils/log";
import { AMBIENT_LIGHT_MODE, OVERDRAW_TEST } from "./overrides";
import { initLocationHelper } from "./helpers/locationHelper";
import Flashlight from "./worldObjects/Flashlight";
import FPSCounter from "./helpers/FPSCounter";
import initKeyboardShortcuts from "./helpers/keyboardShortcuts";
import ScatteredObjectManager from "./ScatteredObjectManager";
import { remapClamp } from "./utils/math";
// import { findIslandSpawn } from "./findIslandSpawn";

// 3D area container
const view3d = document.createElement("div");
document.body.appendChild(view3d);
logTime("start");
// js setup
const renderer = new WebGLRenderer({ antialias: false, logarithmicDepthBuffer: true });

for (const v of ["-moz-crisp-edges", "-webkit-crisp-edges", "crisp-edges", "pixelated"]) {
  renderer.domElement.style.setProperty("image-rendering", v);
}

renderer.autoClear = false;
renderer.setSize(view3d.clientWidth || window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = 2;
view3d.appendChild(renderer.domElement);

const sunVector = new Vector3(1, 1, 0);
// Sun rotation speed around Z axis (radians per second)
const SUN_ANGULAR_SPEED = -0.05;

const sunColorDefault = new Color(1000, 900, 600);
const sunColor = sunColorDefault.clone();
// Define dusk hues
const duskYellow = new Color(80, 80, 0);
const duskRed = new Color(50, 0, 0);

const worldColorTop = new Color(0.3, 0.5, 1);
const worldColorBottomDefault = new Color(0.4, 0.25, 0.1);
const worldColorBottom = worldColorBottomDefault.clone();
const fogColor = worldColorTop;
const wcScale = 2;
const waterColorDefault = new Color(0.05 * wcScale, 0.2 * wcScale, 0.2 * wcScale);
const waterColor = waterColorDefault.clone();

// Preset gradient colors for sky top across the day
const SKY_TOP_DAY = new Color(0.35, 0.6, 1.0); // bright blue
const SKY_TOP_DUSK1 = new Color(1.2, 0.5, 0.15); // orange
const SKY_TOP_DUSK2 = new Color(0.9, 0.15, 0.1); // red
const SKY_TOP_NIGHT = new Color(0.003, 0.01, 0.03); // very dark blue

const bgScene = new Scene();
const sunBallMaterial = new MeshBasicMaterial({
  color: sunColor, // base sun color at/above horizon
  side: DoubleSide,
});
sunBallMaterial.color = sunColor;
const sunBall = new Mesh(new CircleGeometry(0.5, 32), sunBallMaterial);
sunBall.position.copy(sunVector).normalize().multiplyScalar(9);
sunBall.lookAt(new Vector3());
bgScene.add(sunBall);
const groundSkyAmbientMat = new HemisphereAmbientMaterial(
  worldColorTop,
  worldColorBottom,
  fogColor
);
const bgSphere = new Mesh(getSphereGeometry(1, 16, 64), groundSkyAmbientMat);
bgSphere.scale.setScalar(10);
bgScene.add(bgSphere);
const cloudPlane = new Mesh(getPlaneGeometry(1, 1), new CloudPlaneMaterial(worldColorTop));
cloudPlane.scale.setScalar(10);
cloudPlane.position.y = 0.1;
cloudPlane.rotation.x = Math.PI * 0.5;
bgScene.add(cloudPlane);

const envMaker = new PMREMGenerator(renderer);
let envMap = envMaker.fromScene(bgScene, 0.0075);

const scene = new Scene();
if (OVERDRAW_TEST) {
  scene.background = new Color(0x000000);
} else {
  scene.background = envMap.texture;
}

scene.matrixAutoUpdate = false;
scene.matrixWorldAutoUpdate = false;

const camera = new PerspectiveCamera(
  75,
  (view3d.clientWidth || window.innerWidth) / window.innerHeight,
  0.01,
  100000
);
camera.position.set(3, 2, 5);

const dirLight = new DirectionalLight(0xffeebb, 1.5);
dirLight.castShadow = true;

// Ocean plane at y = 0 (follows camera in x/z)
// const oceanSize = 40000; // meters
// const oceanGeom = new PlaneGeometry(oceanSize, oceanSize, 40, 40);
// oceanGeom.rotateX(-Math.PI / 2); // make it horizontal
const oceanManager = new Water(camera, waterColor);
const ocean = oceanManager.visuals;
// ocean.position.set(0, 0, 0);
// ocean.castShadow = false;
// ocean.receiveShadow = true;
scene.add(ocean);
scene.add(oceanManager.refractor);

// Configure shadow properties for better quality
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 500;
dirLight.shadow.bias = -0.0001;

// Initialize position; will be updated each frame
dirLight.position.set(0, 30, 0);
scene.add(dirLight);

// Resize handling
function resize() {
  const width = view3d.clientWidth || window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);

const terrainSeed = 2;

const terrainData = new TerrainData(
  {
    tileResolution: 40,
    maxLOD: 8,
    minLOD: 0,
    tileSize: 20,
    screenSpaceError: 0,
  },
  terrainSeed
);

const probeManager = new ProbeManager(terrainData);

// Debug: visualize probe atlas on a small plane attached to the camera
const debugPlaneGeom = new PlaneGeometry(1, 1);
const debugPlaneMat = new MeshBasicMaterial({
  map: probeManager.getAtlasTexture(),
  side: DoubleSide,
});
const debugPlane = new Mesh(debugPlaneGeom, debugPlaneMat);
// Place it in front of the camera in camera-local space
debugPlane.scale.set(0.9, 0.9, 0.9);
debugPlane.position.set(0.6, -0.25, -1.2); // x-right, y-down, z-forward (negative z is in front of camera)
debugPlane.frustumCulled = false;
// Ensure it faces the camera (plane geometry faces +z by default; we need it to face -z)
debugPlane.rotation.y = Math.PI; // flip to face camera
debugPlane.updateMatrix();
// camera.add(debugPlane);

const terrainMat = makeTerrainMaterial(
  camera.position,
  fogColor,
  waterColor,
  AMBIENT_LIGHT_MODE === "envmap" ? envMap.texture : undefined,
  AMBIENT_LIGHT_MODE === "probes" ? probeManager : undefined
);
const terrainRenderer = new TerrainRenderer(terrainData, scene, terrainMat);

// Indirect lighting probe manager
const terrainSampler = new TerrainSampler(terrainData);
const terrainQuadtree = new TerrainQuadtree(terrainData, terrainSampler);

scene.add(camera);

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

// Timekeeping
let lastTime = performance.now();

const firstPersonController = new FirstPersonController(
  camera,
  terrainSampler,
  renderer,
  terrainRenderer,
  terrainData
);

initLocationHelper(firstPersonController, terrainSampler);

if (AMBIENT_LIGHT_MODE === "hemi") {
  scene.add(new HemisphereLight(0xcceeff, 0x776644, 0.15));
} else if (AMBIENT_LIGHT_MODE === "probes") {
  probeManager.initQueue(camera.position);
}

// Initialize UI dig radius display
const digSpan = document.getElementById("dig-radius");
if (digSpan) digSpan.textContent = `${firstPersonController.digRadius}`;

const scatMan = new ScatteredObjectManager(scene, terrainSampler, terrainMat, camera);

// Movement tracking and temp objects for instanced recycling
const prevCamPos = new Vector3().copy(camera.position);
const camMove = new Vector3();
scene.updateMatrix();

logTime("ready to start rendering");

setInterval(() => {
  const span = document.getElementById("cam-height");
  if (span) span.textContent = `${camera.position.y.toFixed(2)}`;
}, 100);

const flashlight = new Flashlight(camera);
scene.add(flashlight.light);
scene.add(flashlight.lightTarget);

initKeyboardShortcuts(firstPersonController, flashlight);

const fpsCounter = new FPSCounter();

let frameCount = 0;
const frameTimesToLog = 20;
// Render loop
const noop = () => {};
const frameLogTime = (message: string) => logTime(`${frameCount}: ${message}`);
function loop() {
  frameCount++;
  const logFrame = frameCount < frameTimesToLog || frameCount % 300 === 0;
  const myLog = logFrame ? frameLogTime : noop;

  fpsCounter.update();
  myLog("loop cb start");
  const now = performance.now();

  const dt = Math.min(0.05, (now - lastTime) / 1000);
  uniformTime.value += dt;
  lastTime = now;

  // Update first-person controller
  myLog("fpsController");
  firstPersonController.update(dt);
  // debugPlane.position.set(Math.random()*4-2,Math.random()*4-2,Math.random()*4-2); // x-right, y-down, z-forward (negative z is in front of camera)
  camera.updateMatrixWorld();
  debugPlane.updateMatrixWorld();

  // Update systems
  terrainQuadtree.update(camera);

  if (AMBIENT_LIGHT_MODE === "probes") {
    // Update probes and push uniforms to terrain material
    myLog("probeManager");
    probeManager.update(camera.position);
  }

  myLog("terrainRenderer");
  const visTiles = terrainQuadtree.getVisibleTiles();
  terrainRenderer.updateAndRender(camera, visTiles);

  // Update camera matrices so attached HUD elements render correctly
  camera.updateMatrixWorld(true);

  // Animate sun vector around Z axis and update background env
  {
    // Rotate sunVector on Z axis
    const angle = SUN_ANGULAR_SPEED * dt;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const x = sunVector.x;
    const y = sunVector.y;
    // Standard 2D rotation in XY plane around Z
    sunVector.x = x * cosA - y * sinA;
    sunVector.y = x * sinA + y * cosA;

    // Update sun ball to match new sunVector
    sunBall.position.copy(sunVector).normalize().multiplyScalar(9);
    sunBall.lookAt(new Vector3());

    // Tint sun to yellow/red near horizon, then fade to black below horizon
    {
      // visibility factor based on height (y) relative to horizon (0)
      // smoothstep: 0 below -0.1, 1 above +0.1, smooth transition in between
      const y = sunVector.y;
      // const edge0 = -0.1;
      // const edge1 = +0.1;
      // const t = Math.max(0, Math.min(1, (y - edge0) / (edge1 - edge0)));
      // const smooth = t * t * (3 - 2 * t);

      // Compute horizon proximity (0 far from horizon, 1 at horizon)
      const horizonProximity = 1 - Math.abs(Math.max(0.0, y));

      // Blend yellow -> red as it gets even closer to horizon
      sunColor.copy(sunColorDefault);

      sunColor.lerp(duskYellow, horizonProximity);
      sunColor.lerp(duskRed, horizonProximity);

      sunColor.multiplyScalar(remapClamp(-0.1, -0.05, y));
      dirLight.color.copy(sunColor).multiplyScalar(0.0015);

      // // Apply fade below horizon
      // sunColor.multiplyScalar(smooth);

      // Update water color: copy default and modulate by sun color (normalized to [0..1] range)
      const sunColor01 = sunColor.clone().multiplyScalar(1.0 / 1000.0); // normalize large sun color
      sunColor01.multiplyScalar(0.95).addScalar(0.05);
      waterColor.copy(waterColorDefault).multiply(sunColor01);
    }

    // Animate sky top color through day (blue) -> dusk (orange/red) -> night (dark blue)
    {
      // Elevation factor: -1 (deep night) to +1 (high noon) from y component
      const y = Math.max(-1, Math.min(1, sunVector.clone().normalize().y));
      // Map y to [0,1] dayness via smoothstep around horizon
      const dayness = (() => {
        const edge0 = -0.1;
        const edge1 = +0.1;
        const t = Math.max(0, Math.min(1, (y - edge0) / (edge1 - edge0)));
        return t * t * (3 - 2 * t); // smoothstep
      })();

      // Also compute a dusk factor strongest near horizon regardless of above/below
      const horizonProximity = 1 - Math.min(1, Math.abs(y) / 0.3); // 1 at |y|=0, 0 at |y|>=0.3
      const duskStrength = Math.max(0, horizonProximity);

      // Blend: base between night and day, then add dusk hues near horizon
      const baseSky = SKY_TOP_NIGHT.clone().lerp(SKY_TOP_DAY, dayness);

      // Two-phase dusk: orange then red as sun approaches horizon
      const duskColor = SKY_TOP_DUSK1.clone().lerp(
        SKY_TOP_DUSK2,
        Math.max(0, 0.5 - Math.abs(y)) * 2
      );
      const skyTop = baseSky.lerp(duskColor, duskStrength * (1 - Math.abs(y) * 2 + 1) * 0.5);

      // Apply to hemisphere material top color
      worldColorTop.copy(skyTop);
      worldColorBottom.copy(worldColorBottomDefault).multiply(sunColor).multiplyScalar(0.0015);
      // groundSkyAmbientMat.uniformsNeedUpdate = true;
    }

    // Regenerate environment map from bgScene and assign to scene.background
    if (!OVERDRAW_TEST) {
      if (envMap) envMap.texture.dispose();
      envMap = envMaker.fromScene(bgScene, 0.0075);
      scene.background = envMap.texture;

      // If terrain material uses envmap mode, update its envMap reference
      if (AMBIENT_LIGHT_MODE === "envmap") {
        // terrainMat is used by waterSphere and terrain; ensure it sees the new env
        terrainMat.envMap = envMap.texture;
        // terrainMat.needsUpdate = true;
      }
    }
  }

  // Make dirLight follow the camera
  {
    myLog("dirLight");
    const offset = sunVector.clone().multiplyScalar(100);
    const lightPos = new Vector3().copy(camera.position).add(offset);
    dirLight.position.copy(lightPos);
    dirLight.target.position.copy(camera.position);
    dirLight.updateMatrixWorld();
    dirLight.target.updateMatrixWorld();
    dirLight.shadow.camera.updateMatrixWorld();

    // Center shadow camera around the camera for consistent coverage
    const cam = dirLight.shadow.camera;
    const range = 100;
    cam.left = -range;
    cam.right = range;
    cam.top = range;
    cam.bottom = -range;
    cam.updateProjectionMatrix();
  }

  flashlight.update(dt);
  // Make inverted sphere follow the camera X/Z (keep Y fixed so horizon stays stable)
  waterSphere.position.x = camera.position.x;
  waterSphere.position.z = camera.position.z;

  // Optionally also follow Y if desired:
  // skySphere.position.y = camera.position.y;

  myLog("dirtyAABBs");
  const dirtyAABBs = terrainData.popDirtyAABBs();
  scatMan.updateAABBs(dirtyAABBs);

  // Recycle tiny sphere instances when they move beyond spawnRadius
  camMove.subVectors(camera.position, prevCamPos);

  renderer.clearColor();
  renderer.render(scene, camera);
  renderer.clearDepth();
  myLog("oceanManager");
  oceanManager.update();
  myLog("done");
  requestAnimationFrame(loop);
}
resize();
loop();
