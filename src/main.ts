import {
  Color,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  HemisphereLight,
  Mesh,
  CircleGeometry,
  SphereGeometry,
  PMREMGenerator,
  DoubleSide,
  MeshBasicMaterial,
} from "three";
import { TerrainRenderer } from "./terrain/TerrainRenderer";
import { TerrainData } from "./terrain/TerrainData";
import { TerrainQuadtree } from "./terrain/TerrainQuadtree";
import { TerrainSampler } from "./terrain/TerrainSampler";
import FirstPersonController from "./FirstPersonController";
import { StonesManager } from "./worldObjects/StonesManager";
import { TreeManager } from "./worldObjects/TreeManager";
import Water from "./worldObjects/Water";
import { uniformTime } from "./worldObjects/materials/globalUniforms/time";
import CloudPlaneMaterial from "./worldObjects/materials/CloudPlaneMaterial";
import { getPlaneGeometry } from "./worldObjects/geometry/planeGeometry";
import HemisphereAmbientMaterial from "./worldObjects/materials/HemisphereAmbientMaterial";
import { getSphereGeometry } from "./worldObjects/geometry/sphereGeometry";

// 3D area container
const view3d = document.createElement("div");
document.body.appendChild(view3d);

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

const scene = new Scene();

scene.matrixAutoUpdate = false;
scene.matrixWorldAutoUpdate = false;
scene.background = new Color(0x87ceeb); // Sky blue

const camera = new PerspectiveCamera(
  75,
  (view3d.clientWidth || window.innerWidth) / window.innerHeight,
  0.01,
  100000
);
camera.position.set(3, 2, 5);

scene.add(new HemisphereLight(0xcceeff, 0x778877, 0.35));
const dirLight = new DirectionalLight(0xffeebb, 1.5);
dirLight.castShadow = true;

// Ocean plane at y = 0 (follows camera in x/z)
// const oceanSize = 40000; // meters
// const oceanGeom = new PlaneGeometry(oceanSize, oceanSize, 40, 40);
// oceanGeom.rotateX(-Math.PI / 2); // make it horizontal
const oceanManager = new Water(camera);
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

// Re-seed and export handlers
window.addEventListener("keydown", (e) => {
  if (e.key === "[" || e.key === "{") {
    // decrease dig radius nonlinearly; bigger digs change faster
    const r0 = firstPersonController.digRadius;
    const step = Math.max(0.5, Math.min(10, r0 * 0.15)); // 15% of current size, min 0.5, max 10
    let r = Math.max(0.5, r0 - step);
    // rounding rule: <=10 -> nearest 0.5m, >10 -> nearest 1m
    if (r <= 10) {
      r = Math.round(r * 2) / 2;
    } else {
      r = Math.round(r);
    }
    // clamp
    r = Math.max(0.5, Math.min(500, r));
    firstPersonController.digRadius = r;
    const span = document.getElementById("dig-radius");
    if (span) span.textContent = `${firstPersonController.digRadius}`;
  } else if (e.key === "]" || e.key === "}") {
    // increase dig radius nonlinearly; bigger digs change faster
    const r0 = firstPersonController.digRadius;
    const step = Math.max(0.5, Math.min(10, r0 * 0.15)); // 15% of current size, min 0.5, max 10
    let r = Math.min(500, r0 + step);
    // rounding rule: <=10 -> nearest 0.5m, >10 -> nearest 1m
    if (r <= 10) {
      r = Math.round(r * 2) / 2;
    } else {
      r = Math.round(r);
    }
    // clamp
    r = Math.max(0.5, Math.min(500, r));
    firstPersonController.digRadius = r;
    const span = document.getElementById("dig-radius");
    if (span) span.textContent = `${firstPersonController.digRadius}`;
  }
});

const terrainSeed = 2;
const spawnSeed = 7;

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
const terrainRenderer = new TerrainRenderer(terrainData, scene, camera.position);
const terrainSampler = new TerrainSampler(terrainData);
const terrainQuadtree = new TerrainQuadtree(terrainData, terrainSampler);

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

const waterSphere = new Mesh(waterSphereGeom, terrainRenderer.getMaterial());
waterSphere.name = "InvertedFollowSphere";
waterSphere.frustumCulled = false;
waterSphere.renderOrder = 10;
waterSphere.position.set(0, 0, 0);
scene.add(waterSphere);

const sunVector = new Vector3(-1, 1, 1);

const worldColorTop = new Color(0.3, 0.5, 1);
const worldColorBottom = new Color(0.4, 0.25, 0.1);

const bgScene = new Scene();
const sunBall = new Mesh(
  new CircleGeometry(0.5, 32),
  new MeshBasicMaterial({
    color: new Color(10, 9, 6),
    side: DoubleSide,
  })
);
sunBall.position.copy(sunVector).normalize().multiplyScalar(9);
sunBall.lookAt(new Vector3());
bgScene.add(sunBall);
const bgSphere = new Mesh(
  getSphereGeometry(1, 16, 64),
  new HemisphereAmbientMaterial(worldColorTop, worldColorBottom)
);
bgSphere.scale.setScalar(10);
bgScene.add(bgSphere);
const cloudPlane = new Mesh(getPlaneGeometry(1, 1), new CloudPlaneMaterial());
cloudPlane.scale.setScalar(10);
cloudPlane.position.y = 0.1;
cloudPlane.rotation.x = Math.PI * 0.5;
bgScene.add(cloudPlane);

const envMaker = new PMREMGenerator(renderer);
const envMap = envMaker.fromScene(bgScene, 0.0075);
scene.background = envMap.texture;

// Timekeeping
let lastTime = performance.now();

const firstPersonController = new FirstPersonController(
  camera,
  terrainSampler,
  renderer,
  spawnSeed,
  terrainRenderer,
  terrainData
);

// Initialize UI dig radius display
const digSpan = document.getElementById("dig-radius");
if (digSpan) digSpan.textContent = `${firstPersonController.digRadius}`;

// Trees systems: shoreline pines
const treeLayers: TreeManager[] = [
  new TreeManager("pines-L", scene, terrainSampler, terrainRenderer.getMaterial(), 2001, {
    cellSize: 30,
    density: 0.06,
    baseHeight: 8,
    baseRadius: 3,
    lodCapacities: [200, 400, 800, 1200, 2400],
    manageRadius: 100,
    jitter: 0.95,
    minScale: 0.2,
    maxScale: 1.3,
  }),
];
// Stones systems: five layers from large/sparse to small/dense
const stonesLayers: StonesManager[] = [
  // Layer 0: very large, very sparse, see from far away
  new StonesManager("stones-XL", scene, terrainSampler, terrainRenderer.getMaterial(), 1001, {
    cellSize: 30,
    density: 0.00006, // ~0.06 per 1000 m^2
    stoneRadius: 8,
    lodCapacities: [10, 20, 30, 40, 50],
    manageRadius: 1000,
  }), // Layer 1: large, sparse
  new StonesManager("stones-L", scene, terrainSampler, terrainRenderer.getMaterial(), 1002, {
    cellSize: 24,
    density: 0.0002,
    stoneRadius: 4,
    lodCapacities: [10, 20, 30, 40, 50],
    manageRadius: 600,
  }), // Layer 2: medium
  new StonesManager("stones-M", scene, terrainSampler, terrainRenderer.getMaterial(), 1003, {
    cellSize: 18,
    density: 0.003,
    stoneRadius: 2,
    lodCapacities: [20, 40, 60, 80, 100],
    manageRadius: 400,
  }), // Layer 3: small
  new StonesManager("stones-S", scene, terrainSampler, terrainRenderer.getMaterial(), 1004, {
    cellSize: 12,
    density: 0.03,
    stoneRadius: 1,
    lodCapacities: [40, 60, 80, 100, 200],
    manageRadius: 240,
  }), // Layer 4: very small, numerous, only near camera
  new StonesManager("stones-XS", scene, terrainSampler, terrainRenderer.getMaterial(), 1005, {
    cellSize: 8,
    density: 0.1,
    stoneRadius: 0.5,
    lodCapacities: [100, 200, 300, 400, 500],
    manageRadius: 120,
  }),
];

// Movement tracking and temp objects for instanced recycling
const prevCamPos = new Vector3().copy(camera.position);
const camMove = new Vector3();
scene.updateMatrix();
// Render loop
function loop() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  uniformTime.value += dt;
  lastTime = now;

  // Update first-person controller
  firstPersonController.update(dt);

  // Update systems
  terrainQuadtree.update(camera);
  terrainRenderer.updateAndRender(camera, terrainQuadtree.getVisibleTiles());

  // Make dirLight follow the camera
  {
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

  // Make inverted sphere follow the camera X/Z (keep Y fixed so horizon stays stable)
  waterSphere.position.x = camera.position.x;
  waterSphere.position.z = camera.position.z;

  // Optionally also follow Y if desired:
  // skySphere.position.y = camera.position.y;

  const dirtyAABBs = terrainData.popDirtyAABBs();
  for (const layer of stonesLayers) {
    layer.update(camera, dirtyAABBs);
  }
  for (const layer of treeLayers) {
    layer.update(camera, dirtyAABBs);
  }

  // Recycle tiny sphere instances when they move beyond spawnRadius
  camMove.subVectors(camera.position, prevCamPos);

  renderer.clearColor();
  renderer.render(scene, camera);
  renderer.clearDepth();
  oceanManager.update();
  requestAnimationFrame(loop);
}
resize();
loop();
