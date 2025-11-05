import { Mesh, MeshNormalMaterial, Object3D, Texture, WebGLRenderer } from "three";
import { buildImposterAtlas } from "../imposterAtlasMaker";

export const pointCountMax = 8000;

export const stepsYaw = 16;
export const stepsPitch = 8;

export default class PointCloudHelper {
  counter = 0;
  positions = new Float32Array(pointCountMax * 3);
  uvs = new Float32Array(pointCountMax * 2);
  rotNormals = new Float32Array(pointCountMax * 3);
  rotationY = new Float32Array(pointCountMax);
  atlasDiffuse: Texture;
  atlasNormals: Texture;
  constructor(item: Object3D, radius: number, renderer: WebGLRenderer) {
    const normalMaterial = new MeshNormalMaterial();
    // const normalMaterial = createnormalMaterial();

    this.atlasDiffuse = buildImposterAtlas(item, renderer, {
      tileResolution: 256,
      stepsYaw,
      stepsPitch,
      fov: 35,
      radius,
      clearColor: 0x000000,
    });
    item.traverse((obj) => {
      if (obj instanceof Mesh) {
        obj.material = normalMaterial;
      }
    });
    this.atlasNormals = buildImposterAtlas(item, renderer, {
      tileResolution: 256,
      stepsYaw,
      stepsPitch,
      fov: 35,
      radius,
      clearColor: 0x000000,
    });
  }
}
