import {
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
  RGBAFormat,
  FloatType,
  LinearFilter,
} from "three";
import { auroraScroll, auroraStrength } from "../sharedGameData";

export default class AuroraKit {
  private rt: WebGLRenderTarget;
  private scene: Scene;
  private camera: OrthographicCamera;
  private quad: Mesh;
  private material: ShaderMaterial;
  private resolution = new Vector2(1, 1);

  constructor(width = 512, height = 512) {
    // Offscreen render target for the aurora noise
    this.rt = new WebGLRenderTarget(width, height, {
      format: RGBAFormat,
      type: FloatType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });

    // Fullscreen ortho scene
    this.scene = new Scene();
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Shader material with animated simplex noise
    this.material = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uScroll: { value: auroraScroll },
        uStrength: auroraStrength,
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        varying vec2 vUv;
        uniform float uTime;
        uniform vec2 uScroll;
        uniform float uStrength;

        // 2D simplex noise (iq / Stefan Gustavson)
        
        float mod289(float x){return x - floor(x * (1.0 / 289.0)) * 289.0;}
        vec4 mod289(vec4 x){return x - floor(x * (1.0 / 289.0)) * 289.0;}
        vec4 perm(vec4 x){return mod289(((x * 34.0) + 1.0) * x);}

        float noise(vec3 p){
          vec3 a = floor(p);
          vec3 d = p - a;
          d = d * d * (3.0 - 2.0 * d);

          vec4 b = a.xxyy + vec4(0.0, 1.0, 0.0, 1.0);
          vec4 k1 = perm(b.xyxy);
          vec4 k2 = perm(k1.xyxy + b.zzww);

          vec4 c = k2 + a.zzzz;
          vec4 k3 = perm(c);
          vec4 k4 = perm(c + 1.0);

          vec4 o1 = fract(k3 * (1.0 / 41.0));
          vec4 o2 = fract(k4 * (1.0 / 41.0));

          vec4 o3 = o2 * d.z + o1 * (1.0 - d.z);
          vec2 o4 = o3.yw * d.x + o3.xz * (1.0 - d.x);

          return o4.y * d.y + o4.x * (1.0 - d.y);
        }

        void main() {
          vec2 uv = vUv * 10.0 + uScroll;

          // Animate the field slowly
          float n1 = noise(vec3(uv + vec2(19.235,7.54), uTime - uv.x - uv.y));
          float n2 = noise(vec3(uv - vec2(19.235,7.54), uTime - uv.x - uv.y));
          vec2 n12 = vec2(n1, n2);
          uv += n12 * 4.0;
          float n = noise(vec3(uv, uTime - uv.x - uv.y));
          // Sharpen and tint
          float glow = smoothstep(0.4, 0.85, n);

          glow *= smoothstep(0.5, 0.35, length(vUv - vec2(0.5, 0.5))) * uStrength;
          gl_FragColor = vec4(vec3(glow), 1.0);
          // gl_FragColor = vec4(vec3(glow) * color, 1.0);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });

    const geom = new PlaneGeometry(2, 2);
    this.quad = new Mesh(geom, this.material);
    this.scene.add(this.quad);
  }

  // Render animated simplex noise into the internal render target
  // Returns the WebGLRenderTarget for consumption (its .texture can be used as input)
  render(renderer: WebGLRenderer, time: number) {
    if (auroraStrength.value <= 0) return;

    (this.material.uniforms.uTime.value as number) = time * 100.0;

    const prevRT = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prevRT);
  }

  get texture() {
    return this.rt.texture;
  }
}
