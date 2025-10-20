import { Color, ColorRepresentation, DoubleSide, RawShaderMaterial, Vector3 } from "three";

import fragmentShader from "./frag.glsl?raw";
import vertexShader from "./vert.glsl?raw";

export default class CloudPlaneMaterial extends RawShaderMaterial {
  constructor(cloudColor: ColorRepresentation, scroll: Vector3) {
    const color = cloudColor instanceof Color ? cloudColor : new Color(cloudColor);
    super({
      fragmentShader,
      vertexShader,
      depthWrite: false,
      transparent: true,
      side: DoubleSide,
      uniforms: {
        uCloudColor: { value: color },
        uScroll: { value: scroll },
      },
    });
  }
}
