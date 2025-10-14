import { RawShaderMaterial } from "three";

import fragmentShader from "./frag.glsl?raw";
import vertexShader from "./vert.glsl?raw";

export default class CloudPlaneMaterial extends RawShaderMaterial {
  constructor() {
    super({
      fragmentShader,
      vertexShader,
      depthWrite: false,
      transparent: true,
    });
  }
}
