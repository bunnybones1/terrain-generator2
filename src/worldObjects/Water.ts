import {
  type BufferGeometry,
  type Camera,
  Color,
  ConeGeometry,
  type Group,
  Material,
  Matrix4,
  type PerspectiveCamera,
  type Scene,
  ShaderMaterial,
  Vector2,
  type WebGLRenderer,
} from "three";
import { Reflector } from "three/addons/objects/Reflector.js";
import { Refractor } from "three/addons/objects/Refractor.js";
import { generateUUID } from "three/src/math/MathUtils";
import { uniformTime } from "./materials/globalUniforms/time";
import { lerp } from "../utils/math";

export default class Water {
  private uniformDistortionScale: { value: Vector2 };
  visuals: Reflector;
  refractor: Refractor;
  private playerWaterSide = 0;
  constructor(
    private camera: PerspectiveCamera,
    waterColor: Color
  ) {
    const uniformDistortionScale = { value: new Vector2(1, 1) };
    this.uniformDistortionScale = uniformDistortionScale;
    const waterGeometry = new ConeGeometry(1, 0, 16, 12);
    // Square every vertex coordinate (x,y,z) in the geometry
    {
      const posAttr = waterGeometry.getAttribute("position");
      if (posAttr && posAttr.array) {
        const arr = posAttr.array as Float32Array;
        // Scale vertex length (radially) while preserving direction
        for (let i = 0; i < arr.length; i += 3) {
          const x = arr[i];
          const y = arr[i + 1];
          const z = arr[i + 2];
          const r = Math.hypot(x, y, z);
          if (r > 0) {
            // Choose a powering behavior for radius; stronger push at larger radii
            const k = lerp(3.8, 6, Math.min(1, r)); // reuse existing intent
            const r2 = Math.pow(r, k);
            const s = r2 / r;
            arr[i] = x * s;
            arr[i + 1] = y * s;
            arr[i + 2] = z * s;
          }
        }
        posAttr.needsUpdate = true;
        waterGeometry.computeVertexNormals();
        waterGeometry.computeBoundingSphere();
        waterGeometry.computeBoundingBox();
      }
    }
    // Scale and rotate water geometry via matrix (scale 200000, rotate 90deg on X)
    const transform = new Matrix4()
      .makeScale(200000, 200000, 200000)
      .multiply(new Matrix4().makeRotationX(Math.PI / 2));
    waterGeometry.applyMatrix4(transform);
    waterGeometry.computeBoundingSphere();
    waterGeometry.computeBoundingBox();

    const reflector = new Reflector(waterGeometry, {
      textureWidth: 512,
      textureHeight: 512,
      color: 0xffffff,
    });

    reflector.position.y = 1 / 16;
    this.visuals = reflector;
    const p = new Promise<void>((resolve) => {
      if (reflector.material instanceof Material) {
        reflector.material.onBeforeCompile = (shader) => {
          shader.uniforms.uTime = uniformTime;

          // // Ensure camera position is available
          // shader.uniforms.cameraPosition = shader.uniforms.cameraPosition || {
          //   value: camera.position,
          // };

          // Water packed:
          // uWaterAbsorbPack: x=level, y=absorbR, z=absorbG, w=scatterR
          const wapScale = 0.25;
          shader.uniforms.uWaterAbsorbPack = {
            value: { x: 0.0, y: 0.22 * wapScale, z: 0.08 * wapScale, w: 0.02 * wapScale },
          };
          // uWaterScatterPack: xyz=scatterRGB, w=unused (backscatter uses xyz)
          const wspScale = 0.25;
          shader.uniforms.uWaterScatterPack = {
            value: { x: 0.02 * wspScale, y: 0.03 * wspScale, z: 0.08 * wspScale, w: 0.0 },
          };
          shader.uniforms.uWaterColor = {
            value: waterColor,
          };

          shader.uniforms.uDistortionScale = uniformDistortionScale;
          shader.vertexShader = shader.vertexShader.replace(
            "void main() {",
            `
              // uniform vec3 cameraPosition;
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
						uniform vec2 uDistortionScale;
						#include <common>
						#include <normal_pars_fragment>
						varying vec3 vWorldPosition;

            uniform vec4 uWaterAbsorbPack;// x=level, y=absorbR, z=absorbG, w=scatterR
            uniform vec4 uWaterScatterPack;// xyz=scatterRGB
            uniform vec3 uWaterColor;

            vec3 waterAbsorptionFactor(float depth) {
              float d = max(depth, 0.0);
              vec3 k = vec3(uWaterAbsorbPack.y, uWaterAbsorbPack.z, max(uWaterAbsorbPack.z * 0.5, 0.01));
              return exp(-k * d);
            }

            vec3 waterBackscatter(vec3 sigma_s, vec3 waterColor, float L) {
              float len = max(L, 0.0);
              return waterColor * (vec3(1.0) - exp(-sigma_s * len));
            }

            vec3 downwellingAttenuation(float camDepth) {
              float d = max(camDepth, 0.0);
              vec3 k = vec3(uWaterAbsorbPack.y, uWaterAbsorbPack.z, max(uWaterAbsorbPack.z * 0.5, 0.01));
              return exp(-k * d);
            }

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
            vec3 noiseCoord = vec3(vWorldPosition.x * uDistortionScale.y, cy * uDistortionScale.y, vWorldPosition.z * uDistortionScale.y);
						vec3 noiseCoordSmall = noiseCoord * 4.0;
						float fakeY1 = abs(noise(noiseCoord));
						float fakeY2 = abs(noise(noiseCoord + vec3(13.5, 11.5, -0.827)));
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
						vec2 uvReflect = coord.xy + coord.z * fake.xz * 20.0 * uDistortionScale.x;
						vec2 uvRefract = coord.xy + coord.z * -fake.xz * 45.0 * uDistortionScale.x;
						// vec4 base = texture2DProj( tDiffuse, vUv-fake.xzxz );

						vec4 refractColor = texture2D( tDiffuse2, vec2( 1.0 - uvRefract.x, uvRefract.y ) );
						vec4 reflectColor = texture2D( tDiffuse, uvReflect );
            float invRY = 1.0 - abs(reflectVec.y);
            float invRY2 = invRY * invRY * invRY;
						vec4 base = mix(reflectColor, refractColor, 1.0 - (invRY2 * invRY2 * invRY2));
            

        // Compute underwater segment length along the view ray
        vec3 camPos = cameraPosition;
        vec3 toFrag = vWorldPosition - camPos;
        float rayLen = length(toFrag);
        float waterLevel = uWaterAbsorbPack.x;
        float camY = camPos.y;
        float fragY = vWorldPosition.y;
        vec3 rayDir = (rayLen > 0.0) ? toFrag / max(rayLen, 1e-6) : vec3(0.0, -1.0, 0.0);

        float denom = rayDir.y;

        float waterSeg = waterLevel > camY ? rayLen : 0.01;
        float camDepthBelow = max(waterLevel - camY, 0.0);
        vec3 attenColor = uWaterColor * downwellingAttenuation(camDepthBelow);
        vec3 inScattering = waterBackscatter(uWaterScatterPack.xyz, attenColor, waterSeg * waterSeg);

        // Apply water absorption along only the underwater portion
        vec3 k = vec3(uWaterAbsorbPack.y, uWaterAbsorbPack.z, max(uWaterAbsorbPack.z * 0.5, 0.01));
        vec3 transmittance = exp(-k * max(waterSeg, 0.0));
        transmittance *= transmittance * transmittance;
						`
            )
            .replace(
              `gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );`,
              `gl_FragColor = vec4( base.rgb , 1.0 );`
            )
            // .replace(`#include <tonemapping_fragment>`,``)
            .replace(
              `#include <colorspace_fragment>`,
              `
              #include <colorspace_fragment>
              gl_FragColor.rgb *= transmittance;
              gl_FragColor.rgb = gl_FragColor.rgb * (vec3(1.0)-inScattering) + inScattering;
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
      // clipBias: 0.01
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
        // this.visuals.material.uniforms.uDistortionScale = { value: 1 };
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
      this.uniformDistortionScale.value.x = newPlayerWaterSide === -1 ? 50 : 5;
      this.uniformDistortionScale.value.y = 1;
    }
    this.visuals.position.x = this.camera.position.x;
    this.visuals.position.z = this.camera.position.z;
    this.visuals.updateMatrixWorld();
    this.refractor.position.x = this.camera.position.x;
    this.refractor.position.z = this.camera.position.z;
    this.refractor.updateMatrixWorld();
  }
}
