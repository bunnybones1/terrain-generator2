import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import HemisphereAmbientMaterial from "./materials/HemisphereAmbientMaterial";
import { getSphereGeometry } from "./geometry/sphereGeometry";
import CloudPlaneMaterial from "./materials/CloudPlaneMaterial";
import { makeInsanePerspectiveDiscGeometry } from "./geometry/insanePerspectiveDiscGeometryMaker";
import { createNoise3D } from "simplex-noise";
import { PRNG } from "../utils/PRNG";

export default class Sky {
  sunBall: Mesh;
  visuals: Object3D;
  stars?: Object3D;
  constructor(
    private sunVector: Vector3,
    sunColorForEnvMap: Color,
    worldColorTop: Color,
    worldColorBottom: Color,
    fogColor: Color,
    cloudColor: Color,
    cloudScroll: Vector3,
    useStars = true
  ) {
    const seed = 7;
    const rng = new PRNG(seed);
    const simplex = createNoise3D(rng.next);

    const visuals = new Object3D();
    const sunBallMaterial = new MeshBasicMaterial({
      depthWrite: false,
      color: sunColorForEnvMap, // base sun color at/above horizon
      side: DoubleSide,
    });
    sunBallMaterial.color = sunColorForEnvMap;
    const sunBall = new Mesh(new CircleGeometry(0.25, 32), sunBallMaterial);
    this.sunBall = sunBall;
    sunBall.position.copy(sunVector).normalize().multiplyScalar(9);
    sunBall.lookAt(new Vector3());
    visuals.add(sunBall);
    const groundSkyAmbientMat = new HemisphereAmbientMaterial(
      worldColorTop,
      worldColorBottom,
      fogColor
    );
    const bgSphere = new Mesh(getSphereGeometry(1, 16, 64), groundSkyAmbientMat);
    bgSphere.scale.setScalar(10);
    bgSphere.renderOrder = -2;
    visuals.add(bgSphere);
    const cloudMat = new CloudPlaneMaterial(cloudColor, cloudScroll);
    const cloudPlane = new Mesh(makeInsanePerspectiveDiscGeometry(4), cloudMat);
    cloudPlane.scale.setScalar(10);
    cloudPlane.position.y = 0.1;
    cloudPlane.rotation.x = Math.PI * 0.5;
    visuals.add(cloudPlane);

    // Stars: 10,000 points in a hemispherical distribution
    if (useStars) {
      const STAR_COUNT = 10000;
      const RADIUS = 9; // match bgSphere scale*radius-ish so stars sit beyond sky visuals
      const positions = new Float32Array(STAR_COUNT * 3);

      // Uniform-on-hemisphere sampling: pick azimuth phi in [0,2pi), pick z = random in [0,1], derive r = sqrt(1 - z^2)
      for (let i = 0; i < STAR_COUNT; i++) {
        const phi = Math.random() * Math.PI * 2;
        const z = Math.random(); // hemisphere "y" axis up; we'll map z->y
        const r = Math.sqrt(Math.max(0, 1 - z * z));
        const x = r * Math.cos(phi);
        const y = z; // up hemisphere
        const zz = r * Math.sin(phi);

        const finalRadius = RADIUS * (1 - 0.7 * Math.pow(Math.random(), 8));
        const idx = i * 3;
        positions[idx + 0] = (x + simplex(x, y, zz) * 0.15) * finalRadius;
        positions[idx + 1] = (y + simplex(x + 13, y + 17.2, zz + 29.1834) * 0.15) * finalRadius;
        positions[idx + 2] = (zz + simplex(x - 3.724, y + 75.1, zz + 19.75) * 0.15) * finalRadius;
      }

      const starGeom = new BufferGeometry();
      starGeom.setAttribute("position", new BufferAttribute(positions, 3));
      starGeom.computeBoundingSphere();

      const starMat = new PointsMaterial({
        color: new Color(1, 1, 1),
        size: 0.5,
        sizeAttenuation: true,
        depthWrite: false,
        transparent: true,
        opacity: 0.6,
      });

      const stars = new Points(starGeom, starMat);
      // Make point size physically consistent across resolution and FOV:
      // size = angularSizeRad * (renderTargetHeightPx / fovRad)
      const STAR_ANGULAR_SIZE = 0.05; // radians (~0.069°); tweak to taste
      stars.onBeforeRender = (renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera) => {
        void scene;
        const rt = renderer.getRenderTarget();
        const pixelRatio = renderer.getPixelRatio ? renderer.getPixelRatio() : 1;
        const heightPx = rt ? rt.height : renderer.domElement.height * pixelRatio;

        // Vertical FOV in radians; for cube renders use 90°
        const fovRad =
          camera && camera.isPerspectiveCamera ? (camera.fov * Math.PI) / 180 : Math.PI / 2;

        starMat.size = STAR_ANGULAR_SIZE * (heightPx / fovRad);
      };
      stars.renderOrder = -3; // behind bgSphere (-2)
      visuals.add(stars);
      this.stars = stars;
    }

    visuals.updateMatrixWorld(true);
    this.visuals = visuals;
  }
  update() {
    this.sunBall.position.copy(this.sunVector).normalize().multiplyScalar(9);
    this.sunBall.lookAt(new Vector3());
    if (this.stars) {
      this.stars.rotation.y += 0.00005;
    }
  }
}
