import {
  CircleGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Vector3,
} from "three";
import HemisphereAmbientMaterial from "./materials/HemisphereAmbientMaterial";
import { getSphereGeometry } from "./geometry/sphereGeometry";
import CloudPlaneMaterial from "./materials/CloudPlaneMaterial";
import { makeInsanePerspectiveDiscGeometry } from "./geometry/insanePerspectiveDiscGeometryMaker";

export default class Sky {
  sunBall: Mesh;
  visuals: Object3D;
  constructor(
    private sunVector: Vector3,
    sunColorForEnvMap: Color,
    worldColorTop: Color,
    worldColorBottom: Color,
    fogColor: Color,
    cloudColor: Color,
    cloudScroll: Vector3
  ) {
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
    visuals.updateMatrixWorld(true);
    this.visuals = visuals;
  }
  update() {
    this.sunBall.position.copy(this.sunVector).normalize().multiplyScalar(9);
    this.sunBall.lookAt(new Vector3());
  }
}
