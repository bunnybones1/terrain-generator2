import { Color, ColorRepresentation, RawShaderMaterial } from "three";

import fragmentShader from "./frag.glsl?raw";
import vertexShader from "./vert.glsl?raw";

export default class CloudPlaneMaterial extends RawShaderMaterial {
  constructor(cloudColor: ColorRepresentation) {
    const color = cloudColor instanceof Color ? cloudColor : new Color(cloudColor);
    super({
      fragmentShader,
      vertexShader,
      depthWrite: false,
      transparent: true,
      uniforms: {
        uCloudColor: { value: color },
      },
    });
  }
}
