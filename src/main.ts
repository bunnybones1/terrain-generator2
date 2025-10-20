import {
  Color,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  Mesh,
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
import { ProbeManager } from "./lighting/ProbeManager";
import { makeTerrainMaterial } from "./terrain/materials";
import { logTime } from "./utils/log";
import { AMBIENT_LIGHT_MODE, OVERDRAW_TEST } from "./overrides";
import { initLocationHelper } from "./helpers/locationHelper";
import Flashlight from "./worldObjects/Flashlight";
import FPSCounter from "./helpers/FPSCounter";
import initKeyboardShortcuts from "./helpers/keyboardShortcuts";
import ScatteredObjectManager from "./ScatteredObjectManager";
import { updateUIDigRadius } from "./helpers/ui/updateUIDigRadius";
import Sky from "./worldObjects/Sky";
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

let sunAngle = 0.35 * Math.PI * 2;
const sunVector = new Vector3(Math.cos(sunAngle), Math.sin(sunAngle), 0);
// Sun rotation speed around Z axis (radians per second)
const TIME_SPEED = 0.0025;
const ENVMAP_TIME_THRESHOLD = 0.00125;

const sunColorDefault = new Color(1000, 900, 600);
const sunColor = sunColorDefault.clone();
const sunColorForEnvMap = sunColorDefault.clone();

const worldColorTop = new Color(0.3, 0.5, 1);
const worldColorBottomDefault = new Color(0.4, 0.25, 0.1);
const worldColorBottom = worldColorBottomDefault.clone();
const cloudColor = worldColorTop.clone();
const fogColor = worldColorTop;
const wcScale = 2;
const waterColorDefault = new Color(0.05 * wcScale, 0.2 * wcScale, 0.2 * wcScale);
const waterColor = waterColorDefault.clone();

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
  new Color(0.03, 0.1, 0.2), // night
  new Color(0.6, 0.1, 0.1), // red
  new Color(0.6, 0.3, 0.15), // orange
  new Color(0.35, 0.3, 0.3),
  new Color(0.6, 0.6, 0.6),
  new Color(0.6, 0.6, 0.6),
];

const cloudScroll = new Vector3();

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

const bgScene = new Scene();

const skyForEnvMap = new Sky(
  sunVector,
  sunColorForEnvMap,
  worldColorTop,
  worldColorBottom,
  fogColor,
  cloudColor,
  cloudScroll
);
bgScene.add(skyForEnvMap.visuals);
const envMaker = new PMREMGenerator(renderer);
let envMap = envMaker.fromScene(bgScene, 0.0075);

const skyForScene = new Sky(
  sunVector,
  sunColorForEnvMap,
  worldColorTop,
  worldColorBottom,
  fogColor,
  cloudColor,
  cloudScroll
);
skyForScene.visuals.scale.multiplyScalar(10000);
const scene = new Scene();
if (OVERDRAW_TEST) {
  scene.background = new Color(0x000000);
} else {
  scene.add(skyForScene.visuals);
  // scene.background = envMap.texture;
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
updateUIDigRadius(firstPersonController.digRadius);

const scatMan = new ScatteredObjectManager(scene, terrainSampler, terrainMat, camera);

// Movement tracking and temp objects for instanced recycling
const prevCamPos = new Vector3().copy(camera.position);
const camMove = new Vector3();
scene.updateMatrix();

logTime("ready to start rendering");

setInterval(() => {
  const span = document.getElementById("cam-height");
  if (span) span.textContent = `Ascend / Descend (${camera.position.y.toFixed(2)}m)`;
}, 500);

const flashlight = new Flashlight(camera);
scene.add(flashlight.light);
scene.add(flashlight.lightTarget);

initKeyboardShortcuts(firstPersonController, flashlight);

const fpsCounter = new FPSCounter();

let lastSunAngleUpdate = 0;

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
    sunAngle += TIME_SPEED * dt;

    cloudScroll.x = (camera.position.x * 40) / 100000 + sunAngle * 10.0;
    cloudScroll.y = (camera.position.z * 40) / -100000;
    cloudScroll.z = sunAngle * 10;

    sunVector.set(Math.cos(sunAngle), Math.sin(sunAngle), 0);

    skyForEnvMap.update();
    skyForScene.update();

    // Animate world colors via remap points and weighted blend of closest two
    {
      const y = Math.max(-1, Math.min(1, sunVector.clone().normalize().y));
      worldColorTop.copy(getColorFromSunY(skyColors, y));
      cloudColor.copy(getColorFromSunY(cloudColors, y));
      sunColor.copy(getColorFromSunY(sunColors, y));

      dirLight.color.copy(sunColor).multiplyScalar(0.0015);

      sunColorForEnvMap.copy(sunColor).multiplyScalar(0.02);

      // Update water color: copy default and modulate by sun color (normalized to [0..1] range)
      tmp.copy(sunColor).multiplyScalar(1.0 / 1000.0); // normalize large sun color
      tmp.multiplyScalar(0.95).addScalar(0.05);
      waterColor.copy(waterColorDefault).multiply(tmp);

      // Apply to hemisphere material top color
      worldColorBottom.copy(worldColorBottomDefault).multiply(sunColor).multiplyScalar(0.0015);
      // groundSkyAmbientMat.uniformsNeedUpdate = true;
    }

    // Regenerate environment map from bgScene
    if (!OVERDRAW_TEST) {
      if (sunAngle - lastSunAngleUpdate > ENVMAP_TIME_THRESHOLD) {
        lastSunAngleUpdate = sunAngle;

        if (envMap) envMap.texture.dispose();
        envMap = envMaker.fromScene(bgScene, 0.0, undefined, undefined, { size: 1024 });
        // scene.background = envMap.texture;

        // If terrain material uses envmap mode, update its envMap reference
        if (AMBIENT_LIGHT_MODE === "envmap") {
          // terrainMat is used by waterSphere and terrain; ensure it sees the new env
          terrainMat.envMap = envMap.texture;
          // terrainMat.needsUpdate = true;
        }
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
  skyForScene.visuals.position.x = camera.position.x;
  skyForScene.visuals.position.z = camera.position.z;
  skyForScene.visuals.updateMatrixWorld();

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
