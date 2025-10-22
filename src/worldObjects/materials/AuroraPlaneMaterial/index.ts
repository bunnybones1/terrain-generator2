import { AdditiveBlending, DoubleSide, ShaderMaterial, Texture } from "three";

import fragmentShader from "./frag.glsl?raw";
import vertexShader from "./vert.glsl?raw";

export default class AuroraPlaneMaterial extends ShaderMaterial {
  constructor(texture: Texture) {
    super({
      fragmentShader,
      vertexShader,
      // depthWrite: true,
      depthTest: true,
      // side: BackSide,
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
      side: DoubleSide,
      uniforms: {
        uTexture: { value: texture },
      },
    });
  }
}
