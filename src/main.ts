import {
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  Mesh,
  PMREMGenerator,
  DoubleSide,
  MeshBasicMaterial,
  PlaneGeometry,
  HemisphereLight,
  // BasicShadowMap,
  // PCFShadowMap,
  // VSMShadowMap,
  PCFSoftShadowMap,
} from "three";
import { TerrainRenderer } from "./terrain/TerrainRenderer";
import { TerrainData } from "./terrain/TerrainData";
import { TerrainQuadtree } from "./terrain/TerrainQuadtree";
import { TerrainSampler } from "./terrain/TerrainSampler";
import FirstPersonController from "./FirstPersonController";
import { uniformTime } from "./worldObjects/materials/globalUniforms/time";
import { ProbeManager } from "./lighting/ProbeManager";
import { makeTerrainMaterial } from "./terrain/materials";
import { AMBIENT_LIGHT_MODE, OVERDRAW_TEST } from "./overrides";
import { initLocationHelper } from "./helpers/locationHelper";
import Flashlight from "./worldObjects/Flashlight";
import FPSCounter from "./helpers/FPSCounter";
import initKeyboardShortcuts from "./helpers/keyboardShortcuts";
import ScatteredObjectManager from "./ScatteredObjectManager";
import { updateUIDigRadius } from "./helpers/ui/updateUIDigRadius";
import Sky from "./worldObjects/Sky";
import { makeCustomDepthMaterial } from "./terrain/customDepthMaterial";
import { initGreaterOverworld } from "./greaterOverworld";
import { timeBoost, timeSpeed, worldTime } from "./sharedGameData";

const view3d = document.createElement("div");
document.body.appendChild(view3d);
const renderer = new WebGLRenderer({ antialias: false, logarithmicDepthBuffer: true });

for (const v of ["-moz-crisp-edges", "-webkit-crisp-edges", "crisp-edges", "pixelated"]) {
  renderer.domElement.style.setProperty("image-rendering", v);
}

renderer.autoClear = false;
renderer.setSize(view3d.clientWidth || window.innerWidth, window.innerHeight);
// renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
// renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
// renderer.shadowMap.type = BasicShadowMap;
// renderer.shadowMap.type = PCFShadowMap;
renderer.shadowMap.type = PCFSoftShadowMap;
// renderer.shadowMap.type = VSMShadowMap;
view3d.appendChild(renderer.domElement);

const scene = new Scene();

scene.matrixAutoUpdate = false;
scene.matrixWorldAutoUpdate = false;

const camera = new PerspectiveCamera(
  75,
  (view3d.clientWidth || window.innerWidth) / window.innerHeight,
  0.01,
  100000
);
camera.position.set(3, 2, 5);

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

const bgScene = new Scene();

const skyMaker = new Sky();
const skyForEnvMap = skyMaker.createVisuals(false);
bgScene.add(skyForEnvMap.root);
const envMaker = new PMREMGenerator(renderer);
let envMap = envMaker.fromScene(bgScene, 0.0075);

const terrainMat = makeTerrainMaterial(
  camera.position,
  AMBIENT_LIGHT_MODE === "envmap" ? envMap.texture : undefined,
  AMBIENT_LIGHT_MODE === "probes" ? probeManager : undefined
);
const overWorld = initGreaterOverworld(scene, camera, renderer, terrainMat, skyMaker);

const terrainDepthMat = makeCustomDepthMaterial();
const terrainRenderer = new TerrainRenderer(terrainData, scene, terrainMat, terrainDepthMat);

// Indirect lighting probe manager
const terrainSampler = new TerrainSampler(terrainData);
const terrainQuadtree = new TerrainQuadtree(terrainData, terrainSampler);

scene.add(camera);

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

const scatMan = new ScatteredObjectManager(
  scene,
  terrainSampler,
  terrainMat,
  terrainDepthMat,
  camera
);

scene.updateMatrix();

setInterval(() => {
  const span = document.getElementById("cam-height");
  if (span) span.textContent = `Ascend / Descend (${camera.position.y.toFixed(2)}m)`;
}, 500);

const flashlight = new Flashlight(camera);
scene.add(flashlight.light);
scene.add(flashlight.lightTarget);

initKeyboardShortcuts(firstPersonController, flashlight);

const fpsCounter = new FPSCounter();

// Real-time tracker for 2 Hz envmap updates
let lastEnvmapUpdateMs = performance.now();

// Render loop
function loop() {
  fpsCounter.update();
  const now = performance.now();

  const dt = Math.min(0.05, (now - lastTime) / 1000);

  // Exponential decay that is framerate-independent: value *= exp(-lambda * dt)
  const decayRate = 1.2;
  timeBoost.value *= Math.exp(-decayRate * dt);

  worldTime.value += (timeSpeed.value + timeBoost.value) * dt;

  uniformTime.value += dt;
  lastTime = now;

  // Update first-person controller
  firstPersonController.update(dt);
  // debugPlane.position.set(Math.random()*4-2,Math.random()*4-2,Math.random()*4-2); // x-right, y-down, z-forward (negative z is in front of camera)
  camera.updateMatrixWorld();
  debugPlane.updateMatrixWorld();

  // Update systems
  terrainQuadtree.update(camera);

  if (AMBIENT_LIGHT_MODE === "probes") {
    // Update probes and push uniforms to terrain material
    probeManager.update(camera.position);
  }

  const visTiles = terrainQuadtree.getVisibleTiles();
  terrainRenderer.updateAndRender(camera, visTiles);

  // Update camera matrices so attached HUD elements render correctly
  camera.updateMatrixWorld(true);

  skyMaker.auroraKit.render(renderer, worldTime.value * 0.15);
  overWorld.update();

  // Animate sun vector around Z axis and update background env
  {
    // Regenerate environment map from bgScene
    if (!OVERDRAW_TEST) {
      // Tick exactly 2 times per second (every 500ms) regardless of worldTime
      if (now - lastEnvmapUpdateMs >= 500) {
        lastEnvmapUpdateMs = now;

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

  flashlight.update(dt);

  const dirtyAABBs = terrainData.popDirtyAABBs();
  scatMan.updateAABBs(dirtyAABBs);

  renderer.clearColor();
  renderer.render(scene, camera);
  renderer.clearDepth();
  requestAnimationFrame(loop);
}
resize();
loop();
