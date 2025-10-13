import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  AmbientLight,
  AxesHelper,
  Color,
  DirectionalLight,
  GridHelper,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from "three";
import TerrainSystem from "./TerrainSystem";

// 3D area container
const view3d = document.createElement("div");
// view3d.style.cssText = "position:relative;";
document.body.appendChild(view3d);

// js setup
const renderer = new WebGLRenderer({ antialias: true });
renderer.setSize(view3d.clientWidth || window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = 2; // PCFSoftShadowMap for softer shadows
view3d.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(0x87ceeb); // Sky blue

const camera = new PerspectiveCamera(
  55,
  (view3d.clientWidth || window.innerWidth) / window.innerHeight,
  0.1,
  1000
);
camera.position.set(3, 2, 5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new AmbientLight(0xffffff, 0.35));
const dirLight = new DirectionalLight(0xffffff, 1.5);
dirLight.position.set(5, 8, 3);
dirLight.castShadow = true;

// Configure shadow properties for better quality
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 50;
dirLight.shadow.camera.left = -10;
dirLight.shadow.camera.right = 10;
dirLight.shadow.camera.top = 10;
dirLight.shadow.camera.bottom = -10;
dirLight.shadow.bias = -0.0001;

scene.add(dirLight);

// Helpers
const grid = new GridHelper(10, 10, 0x333333, 0x222222);
scene.add(grid);
const axes = new AxesHelper(1);
scene.add(axes);

const terrain = new TerrainSystem(scene, camera);

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
  const key = e.key.toLowerCase();
  if (key === "r") {
    terrain.initializeNoise();
  } else if (key === "e") {
    //EXPORT
  }
});

terrain.update();

// Render loop
// const startTime = performance.now();
function loop() {
  // const now = performance.now();
  // const tSec = (now - startTime) / 10000;

  // updateTerrain(tSec);

  controls.update();

  // Update grass visibility based on camera frustum
  terrain.update();

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
resize();
loop();
