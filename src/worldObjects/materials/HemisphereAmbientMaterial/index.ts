import { BackSide, Color, type ColorRepresentation, RawShaderMaterial, Uniform } from "three";

import fragmentShader from "./frag.glsl?raw";
import vertexShader from "./vert.glsl?raw";

export default class HemisphereAmbientMaterial extends RawShaderMaterial {
  constructor(colorTop: ColorRepresentation, colorBottom: ColorRepresentation) {
    const uColorTop = new Uniform(colorTop instanceof Color ? colorTop : new Color(colorTop));
    const uColorBottom = new Uniform(
      colorBottom instanceof Color ? colorBottom : new Color(colorBottom)
    );
    super({
      uniforms: {
        uColorTop,
        uColorBottom,
      },
      fragmentShader,
      vertexShader,
      side: BackSide,
      depthWrite: false,
    });
  }
}
