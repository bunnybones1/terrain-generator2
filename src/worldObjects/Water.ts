import {
  type BufferGeometry,
  type Camera,
  type Group,
  Material,
  type PerspectiveCamera,
  type Scene,
  ShaderMaterial,
  type WebGLRenderer,
} from "three";
import { Reflector } from "three/addons/objects/Reflector.js";
import { Refractor } from "three/addons/objects/Refractor.js";
import { generateUUID } from "three/src/math/MathUtils";
import { getPlaneGeometry } from "./geometry/planeGeometry";
import { uniformTime } from "./materials/globalUniforms/time";

export default class Water {
  private uniformDistortionScale: { value: number };
  visuals: Reflector;
  refractor: Refractor;
  private playerWaterSide = 0;
  constructor(private camera: PerspectiveCamera) {
    const uniformDistortionScale = { value: 1 };
    this.uniformDistortionScale = uniformDistortionScale;
    const waterGeometry = getPlaneGeometry(30000, 30000, 40, 40);
    const reflector = new Reflector(waterGeometry, {
      textureWidth: 512,
      textureHeight: 512,
      color: 0x7788aa,
    });
    reflector.position.y = 1 / 16;
    this.visuals = reflector;
    const p = new Promise<void>((resolve) => {
      if (reflector.material instanceof Material) {
        reflector.material.onBeforeCompile = (shader) => {
          shader.uniforms.uTime = uniformTime;
          shader.uniforms.uDistortionScale = uniformDistortionScale;
          shader.vertexShader = shader.vertexShader.replace(
            "void main() {",
            `
							#include <normal_pars_vertex>
							varying vec3 vWorldPosition;
							void main() {
								#include <beginnormal_vertex>
								#include <defaultnormal_vertex>
								#include <normal_vertex>
								vec3 transformed = vec3( position );
								#include <worldpos_vertex>
								vWorldPosition = worldPosition.xyz;
							`
          );
          shader.fragmentShader = shader.fragmentShader
            .replace(
              "void main() {",
              `
						uniform float uTime;
						uniform sampler2D tDiffuse2;
						uniform float uDistortionScale;
						#include <common>
						#include <normal_pars_fragment>
						varying vec3 vWorldPosition;

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
						#include <normal_fragment_begin>
						vec3 cameraToFragPos = vWorldPosition - cameraPosition;
						vec3 cameraToFrag = normalize( cameraToFragPos );
						vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
						float cy = uTime + (vWorldPosition.x+vWorldPosition.z) * 0.5;
            vec3 noiseCoord = vec3(vWorldPosition.x, cy, vWorldPosition.z);
						vec3 noiseCoordSmall = noiseCoord * 4.0;
						float fakeY1 = abs(noise(noiseCoord));
						float fakeY2 = abs(noise(noiseCoord + vec3(13.5,11.5, -0.827)));
						float fakeY1s = abs(noise(noiseCoordSmall));
						float fakeY2s = abs(noise(noiseCoordSmall + vec3(13.5,11.5, -0.827)));
						float fakeY = min(fakeY1, fakeY2) + min(fakeY1s, fakeY2s) * 0.1;
						vec3 fake = normalize(vec3(dFdx(fakeY), fakeY * 0.2, dFdy(fakeY))) * min(0.5, abs(cameraToFrag.y) / length(cameraToFragPos) * 5.0);
						vec3 reflectVec = reflect( cameraToFrag, normalize(worldNormal + fake));
						`
            )
            .replace(
              "vec4 base = texture2DProj( tDiffuse, vUv );",
              `
						vec3 coord = vUv.xyz / vUv.w;
						vec2 uvReflect = coord.xy + coord.z * fake.xz * 20.0 * uDistortionScale;
						vec2 uvRefract = coord.xy + coord.z * -fake.xz * 45.0 * uDistortionScale;
						// vec4 base = texture2DProj( tDiffuse, vUv-fake.xzxz );

						vec4 refractColor = texture2D( tDiffuse2, vec2( 1.0 - uvRefract.x, uvRefract.y ) );
						vec4 reflectColor = texture2D( tDiffuse, uvReflect );
						vec4 base = mix(reflectColor, refractColor, abs(reflectVec.y));
						`
            );

          resolve();
        };
        const matUuid = generateUUID();
        reflector.material.customProgramCacheKey = () => matUuid;
      }
    });

    const refractor = new Refractor(waterGeometry, {
      textureWidth: 512,
      textureHeight: 512,
    });

    refractor.position.y = 0.9 / 16;
    this.refractor = refractor;
    refractor.visible = false;
    refractor.material.visible = false;
    p.then(() => {
      if (
        this.visuals.material instanceof ShaderMaterial &&
        this.refractor.material instanceof ShaderMaterial
      ) {
        const geo2 = this.refractor.geometry;
        const mat2 = this.refractor.material;
        const oldBeforeRender = this.visuals.onBeforeRender.bind(this.visuals);
        this.visuals.onBeforeRender = (
          renderer: WebGLRenderer,
          scene: Scene,
          camera: Camera,
          geometry: BufferGeometry,
          material: Material,
          group: Group
        ) => {
          this.visuals.visible = false;
          this.refractor.visible = false;
          oldBeforeRender(renderer, scene, camera, geometry, material, group);
          this.refractor.onBeforeRender(renderer, scene, camera, geo2, mat2, group);
          this.refractor.visible = false;
          this.visuals.visible = true;
        };
        this.visuals.material.uniforms.tDiffuse2 = this.refractor.material.uniforms.tDiffuse;
        this.visuals.material.uniforms.uDistortionScale = { value: 1 };
      }
    });
  }
  update() {
    const newPlayerWaterSide = this.camera.position.y < 0 ? -1 : 1;
    if (newPlayerWaterSide !== this.playerWaterSide) {
      this.playerWaterSide = newPlayerWaterSide;
      const playerWaterSide = newPlayerWaterSide === -1 ? 0.5 : -0.5;
      this.visuals.rotation.x = Math.PI * playerWaterSide;
      this.refractor.rotation.x = Math.PI * playerWaterSide;
      this.refractor.position.y = (1 + playerWaterSide * 0.2) / 16;
      this.uniformDistortionScale.value = newPlayerWaterSide === -1 ? 100 : 5;
    }
    this.visuals.position.x = this.camera.position.x;
    this.visuals.position.z = this.camera.position.z;
    this.visuals.updateMatrixWorld();
    this.refractor.position.x = this.camera.position.x;
    this.refractor.position.z = this.camera.position.z;
    this.refractor.updateMatrixWorld();
  }
}
