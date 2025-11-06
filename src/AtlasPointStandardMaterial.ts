import { MeshStandardMaterial, ShaderChunk, Texture, Vector2 } from "three";
import { POWER_SHADOWS, POWER_SHADOWS_POWER } from "./overrides";
import { worldTime } from "./sharedGameData";
import { waterAbsorbPack, waterColor, waterScatterPack } from "./sharedWaterShaderControls";
import { fogColor } from "./gameColors";

// A ShaderMaterial that renders big square points, sampling from an atlas
// made of (stepsYaw x stepsPitch) tiles. It picks a tile based on the
// quantized yaw/pitch from camera to the point.
export function createAtlasPointStandardMaterial(params: {
  atlasNormals: Texture;
  atlasDiffuse: Texture;
  envMap: Texture;
  stepsYaw: number;
  stepsPitch: number;
  pointSize?: number;
}) {
  const { atlasNormals, atlasDiffuse, envMap, stepsYaw, stepsPitch, pointSize = 64.0 } = params;
  const pointSizeUniform = { value: pointSize };

  const material = new MeshStandardMaterial({
    transparent: false,
    color: 0xffffff,
    depthWrite: true,
    alphaTest: 0.5,
    roughness: 0.7,
    metalness: 0.1,
    map: atlasDiffuse,
    normalMap: atlasNormals,
    envMap: envMap,
    envMapIntensity: 0.15,
    userData: {
      pointSizeUniform,
    },
  });

  const varyings = `
      varying vec3 vViewDir;
      varying vec3 vWorldPos;

      // Virtual target in screen space (NDC) we want to rotate towards
      varying vec2 vVirtualNDC;
      // Center of this point in NDC
      varying vec2 vPointNDC;

      // Pass-through for per-point yaw rotation
      varying float vRotationY;

      varying vec3 vCamVec;
      varying float vDepth;
      varying float vAngle;

      varying vec2 vTileSize;
      varying vec2 vTileMin;

      varying float vPointSize;

      varying vec3 vBillboardUp;

`;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.pointSize = pointSizeUniform;
    shader.uniforms.time = worldTime;
    shader.uniforms.steps = { value: new Vector2(stepsYaw, stepsPitch) };
    shader.uniforms.aspect = { value: 0.6 }; // viewport width/height,
    shader.uniforms.uWaterAbsorbPack = { value: waterAbsorbPack };
    shader.uniforms.uWaterScatterPack = { value: waterScatterPack };
    shader.uniforms.uWaterColor = { value: waterColor };
    shader.uniforms.uAirFogColor = { value: fogColor };
    shader.uniforms.uAirFogDensity = { value: 0.0002 };

    const lights_fragment_maps_custom = ShaderChunk.lights_fragment_maps
      .split(`iblIrradiance += getIBLIrradiance( geometryNormal );`)
      .join(`iblIrradiance += getIBLIrradiance( geometryNormal ) * transmittance;`)
      .replace(
        `radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );`,
        `radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness ) * transmittance;`
      );

    const lights_fragment_begin_custom = ShaderChunk.lights_fragment_begin.replace(
      `getDirectionalLightInfo( directionalLight, directLight );`,
      `getDirectionalLightInfo( directionalLight, directLight );
          directLight.color *= transmittance;`
    );
    shader.vertexShader = shader.vertexShader
      .replace(
        `#include <common>`,
        `${varyings}
        #include <common>
        `
      )
      .replace(
        `void main() {`,
        `
        uniform float pointSize;
        uniform float time;
        uniform float aspect;
        uniform vec2 steps;

        attribute float rotationY;

        // Rotate vector v so that world up (0,1,0) aligns with n using Rodrigues' rotation formula
        vec3 rotateViewByNormal(vec3 v, vec3 n) {
          vec3 up = vec3(0.0, 1.0, 0.0);
          vec3 nn = normalize(n);
          float c = clamp(dot(up, nn), -1.0, 1.0);
          if (c > 0.9999) return v;
          if (c < -0.9999) {
            // 180-degree rotation around any axis orthogonal to up, choose X axis
            return vec3(v.x, -v.y, v.z);
          }
          vec3 axis = normalize(cross(up, nn));
          float angle = acos(c);
          float s = sin(angle);
          float one_c = 1.0 - c;
          return v * c + cross(axis, v) * s + axis * (dot(axis, v) * one_c);
        }

        // Return yaw (0..2PI) around Y, and pitch (0..PI/2) elevation from horizon to top
        // Based on view direction from camera to point.
        void computeAngles(in vec3 dir, out float yaw, out float pitch) {
          vec3 d = normalize(dir);
          yaw = atan(d.x, d.z);
          if (yaw < 0.0) yaw += 6.283185307179586;
          float elev = asin(clamp(d.y, -1.0, 1.0));
          pitch = clamp(elev, 0.0, 1.5707963267948966);
        }

        void main() {
        vec2 vUv = vec2(0.0);`
      )
      .replace(
        `#include <worldpos_vertex>`,
        `#include <worldpos_vertex>
        
        // camera position in world is available via cameraPosition
        vec3 delta = cameraPosition - worldPosition.xyz;
        vec3 baseViewDir = normalize(delta);
        // Rotate view direction by per-point normal; do not pass normal further
        float fastTime = time * 1000.0;
        // float rna = atan(-normal.y, -normal.x);
        float baseAngle = atan(-normal.y, -normal.x);
        float swayOffset = (sin(fastTime + position.x * 2.0) * 0.25 + sin(fastTime + (position.x * 0.5)) * 0.5) * smoothstep(1.5, 3.0, length(delta));
        float rna = baseAngle + swayOffset;

        vec3 baseNormal = normalize(vec3(cos(baseAngle), sin(baseAngle), normal.z));
        vec3 baseNormal2 = normalize(vec3(cos(baseAngle-swayOffset), sin(baseAngle-swayOffset), normal.z));
        vec3 swayNormal = normalize(vec3(cos(rna), sin(rna), normal.z));

        vec3 viewDirSway = rotateViewByNormal(baseViewDir, swayNormal);

        vViewDir = viewDirSway;
        vBillboardUp = baseNormal2;

        // Build a stable world-space basis from the swayed normal (surface up) and camera right for handedness
        vec3 N = swayNormal; // surface up/normal in world space for billboard orientation
        vec3 upRef = abs(N.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
        vec3 T = normalize(cross(upRef, N)); // right
        vec3 B = cross(N, T); // forward aligned with surface

        // Compute clip-space for point center
        // vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vec4 clipPos = projectionMatrix * mvPosition;
        gl_Position = clipPos;
        vWorldPos = worldPosition.xyz;

        // Compute point center in NDC
        vec3 ndc = clipPos.xyz / clipPos.w;
        vPointNDC = ndc.xy;

        // Compute virtual world point 1.5m below the camera on world Y axis
        vec3 virtualWorld = cameraPosition + rotateViewByNormal(vec3(0.0, -1.5, 0.0), swayNormal);

        // Project camera and virtual world point into clip space
        vec4 camClip = projectionMatrix * viewMatrix * vec4(cameraPosition, 1.0);
        vec4 virtClip = projectionMatrix * viewMatrix * vec4(virtualWorld, 1.0);
        virtClip.w = abs(virtClip.w); // ensure below camera stays below in clip space

        // Convert to NDC
        vec2 camNDC = (camClip.xyz / camClip.w).xy;
        vec2 virtNDC = (virtClip.xyz / virtClip.w).xy;

        // Our virtual target is the projected virtual point
        vVirtualNDC = virtNDC;

        // Pass the per-point yaw rotation to fragment
        // vRotationY = 0.0;
        vRotationY = rotationY;

        // perspective size: gl_PointSize in pixels
        float depth = -mvPosition.z; // positive forward
        vDepth = depth;
        float f = projectionMatrix[1][1]; // cot(fov/2)
        gl_PointSize = pointSize * (f / max(depth, 0.0001));
        vPointSize = gl_PointSize;
        vCamVec = baseViewDir;

        // Compute angle to virtual point in screen space.
        vec2 fromCenterToTarget = vVirtualNDC - vPointNDC;
        fromCenterToTarget.x *= aspect;
        vAngle = atan(fromCenterToTarget.x, -fromCenterToTarget.y);
        
        float yaw, pitch;
        computeAngles(vViewDir, yaw, pitch);
        yaw = mod(yaw + vRotationY, 6.283185307179586);
        // yaw = mod(yaw, 6.283185307179586);
        if (yaw < 0.0) yaw += 6.283185307179586;

        float stepsYaw = max(1.0, steps.x);
        float stepsPitch = max(1.0, steps.y);

        float tYaw = yaw / 6.283185307179586;
        float tPitch = (stepsPitch <= 1.0) ? 1.0 : (pitch / 1.5707963267948966);

        float iYaw = floor(tYaw * stepsYaw);
        float iPitch = floor(tPitch * (stepsPitch));
        iYaw = clamp(iYaw, 0.0, stepsYaw - 1.0);
        iPitch = clamp(iPitch, 0.0, stepsPitch - 1.0);

        vTileSize = vec2(1.0/stepsYaw, 1.0/stepsPitch);
        vTileMin = vec2(iYaw, iPitch) * vTileSize;

      // #if defined( USE_UV )
      //   vUv_internal = uv;
      // #endif`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        `#include <common>`,
        `${varyings}
        #include <common>
        uniform vec4 uWaterAbsorbPack;
        uniform vec4 uWaterScatterPack;
        uniform vec3 uWaterColor;
        uniform vec3 uAirFogColor;
        uniform float uAirFogDensity;

        vec3 atlasCamPos;
        vec3 atlasToFrag;
        float atlasRayLen;
        float atlasWaterSeg;

        vec3 waterBackscatter(vec3 sigma_s, vec3 tint, float L) {
          float len = max(L, 0.0);
          return tint * (vec3(1.0) - exp(-sigma_s * len));
        }

        float airFogFactor(float distance, float density) {
          float d = max(distance, 0.0);
          return clamp(1.0 - exp(-density * d), 0.0, 1.0);
        }

        vec3 downwellingAttenuation(float camDepth) {
          float d = max(camDepth, 0.0);
          vec3 k = vec3(uWaterAbsorbPack.y, uWaterAbsorbPack.z, max(uWaterAbsorbPack.z * 0.5, 0.01));
          return exp(-k * d);
        }`
      )
      .replace(
        `void main() {`,
        `
        // Rotate vector by yaw around Y, then pitch around X
        vec3 rotateByYawPitch(vec3 v, float yaw, float pitch) {
          float cy = cos(yaw), sy = sin(yaw);
          vec3 vy = vec3(cy * v.x + sy * v.z, v.y, -sy * v.x + cy * v.z);
          float cp = cos(pitch), sp = sin(pitch);
          vec3 vyp = vec3(vy.x, cp * vy.y - sp * vy.z, sp * vy.y + cp * vy.z);
          return normalize(vyp);
        }

        // Rotate a 2D vector by angle (radians)
        vec2 rotate2D(vec2 p, float a) {
          float s = sin(a), c = cos(a);
          return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
        }

        // Rotate vector v so that world up (0,1,0) aligns with n using Rodrigues' rotation formula
        vec3 rotateViewByNormal(vec3 v, vec3 n) {
          vec3 up = vec3(0.0, 1.0, 0.0);
          vec3 nn = normalize(n);
          float c = clamp(dot(up, nn), -1.0, 1.0);
          if (c > 0.9999) return v;
          if (c < -0.9999) {
            return vec3(v.x, -v.y, v.z);
          }
          vec3 axis = normalize(cross(up, nn));
          float angle = acos(c);
          float s = sin(angle);
          float one_c = 1.0 - c;
          return v * c + cross(axis, v) * s + axis * (dot(axis, v) * one_c);
        }

        void main() {
        //dither and discard based on distance to avoid harsh LOD popping
          float ditherScale = 0.1;
          float dither = fract(sin(dot(gl_FragCoord.xy ,vec2(12.9898,78.233))) * 43758.5453);
          // if(vDepth > (vPointSize * 0.5) && dither < clamp((vDepth - vPointSize * 0.5) * ditherScale, 0.0, 1.0)) discard;
          float start = 40.0;
          float end   = 60.0;
          float ramp  = clamp((vDepth - start) / max(end - start, 1e-3), 0.0, 1.0);
          if (vDepth > start && dither < ramp) discard;
          if(length(gl_PointCoord - vec2(0.5)) > 0.5) discard; // circular points
          vec2 uvPoint = vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y);

          vec2 p = uvPoint - 0.5;
          p = rotate2D(p, vAngle);
          uvPoint = p + 0.5;

          vec2 uv = vTileMin + uvPoint * vTileSize;

        `
      )
      .replace(
        `#include <map_fragment>`,
        ShaderChunk.map_fragment.replace(`texture2D( map, vMapUv );`, `texture2D( map, uv);`)
      )
      .replace(
        `#include <normal_fragment_maps>`,
        `
        #ifdef USE_NORMALMAP
          vec3 atlasNormal = texture2D( normalMap, uv ).xyz * 2.0 - 1.0;
          atlasNormal = normalize( atlasNormal );

          // Apply per-point random spin around canonical up to avoid repetition.
          float c = cos( vRotationY );
          float s = sin( vRotationY );
          atlasNormal = vec3(
            c * atlasNormal.x - s * atlasNormal.z,
            atlasNormal.y,
            s * atlasNormal.x + c * atlasNormal.z
          );

          // Reorient normals from atlas(+Y up) into the tilted billboard basis.
          vec3 worldNormal = rotateViewByNormal( atlasNormal, vBillboardUp );

          
          // Convert to view space for standard lighting evaluation.
          vec3 viewNormal = normalize( ( viewMatrix * vec4( worldNormal, 0.0 ) ).xyz );
          vec3 finalNormal = normalize(mix(viewNormal, -normal, 0.85));

          #ifdef FLIP_SIDED
            finalNormal = -finalNormal;
          #endif
          #ifdef DOUBLE_SIDED
            finalNormal = finalNormal * faceDirection;
          #endif

          normal = finalNormal;
          nonPerturbedNormal = finalNormal;
        #endif
        `
      )
      .replace(
        `#include <shadowmap_pars_fragment>`,
        ShaderChunk.shadowmap_pars_fragment.replace(
          `shadowCoord.z += shadowBias;`,
          POWER_SHADOWS
            ? `
                //uncollapse UV from customDepthMaterial.ts
                vec2 tmp = shadowCoord.xy * 2.0 - 1.0;
                shadowCoord.z += shadowBias + length(tmp) * -0.0025;
                tmp = (vec2(1.0) - pow(vec2(1.0) - abs(tmp), vec2(${POWER_SHADOWS_POWER}))) * sign(tmp);
                shadowCoord.xy = tmp * 0.5 + 0.5;
                `
            : `shadowCoord.z += shadowBias;`
        )
      )
      .replace(
        `#include <lights_fragment_begin>`,
        `
        atlasCamPos = cameraPosition;
        atlasToFrag = vWorldPos - atlasCamPos;
        atlasRayLen = length(atlasToFrag);

        float waterLevel = uWaterAbsorbPack.x;
        vec3 rayDir = (atlasRayLen > 0.0) ? atlasToFrag / max(atlasRayLen, 1e-6) : vec3(0.0, -1.0, 0.0);

        float camY = atlasCamPos.y;
        float fragY = vWorldPos.y;

        float waterSeg = 0.0;
        float denom = rayDir.y;

        if (abs(denom) < 1e-6) {
          if (camY < waterLevel && fragY < waterLevel) {
            waterSeg = atlasRayLen;
          }
        } else {
          float tHit = (waterLevel - camY) / denom; // param where ray hits the plane
          bool camUnder = camY < waterLevel;
          bool fragUnder = fragY < waterLevel;

          if (camUnder && fragUnder) {
            waterSeg = atlasRayLen;
          } else if (!camUnder && !fragUnder) {
            waterSeg = 0.0;
          } else {
            float t = clamp(tHit, 0.0, atlasRayLen);
            if (camUnder && !fragUnder) {
              waterSeg = t;
            } else if (!camUnder && fragUnder) {
              waterSeg = max(atlasRayLen - t, 0.0);
            } else {
              waterSeg = 0.0;
            }
          }
        }

        atlasWaterSeg = waterSeg;

        vec3 k = vec3(uWaterAbsorbPack.y, uWaterAbsorbPack.z, max(uWaterAbsorbPack.z * 0.5, 0.01));
        vec3 transmittance = exp(-k * max(waterSeg, 0.0));

        float fragDepthBelow = max(waterLevel - fragY, 0.0);
        if (fragDepthBelow > 0.0) {
          float depthFactor = 1.0 - exp(-uWaterAbsorbPack.z * fragDepthBelow);
          vec3 attenDown = downwellingAttenuation(fragDepthBelow) * uWaterColor;
          vec3 waterFilter = mix(vec3(1.0), attenDown, depthFactor);
          transmittance *= waterFilter;
        }
        transmittance *= transmittance * transmittance * transmittance * transmittance;

        ${lights_fragment_begin_custom}
        `
      )
      .replace(`#include <lights_fragment_maps>`, lights_fragment_maps_custom)
      .replace(
        `#include <fog_fragment>`,
        `
        float camDepthBelow = max(waterLevel - atlasCamPos.y, 0.0);
        vec3 attenColor = uWaterColor * downwellingAttenuation(camDepthBelow);
        vec3 inScattering = waterBackscatter(uWaterScatterPack.xyz, attenColor, atlasWaterSeg * atlasWaterSeg);

        vec3 dirF = (atlasRayLen > 0.0) ? atlasToFrag / atlasRayLen : vec3(0.0);

        bool camAbove = atlasCamPos.y >= waterLevel;
        bool fragAbove = vWorldPos.y >= waterLevel;

        float airDist = 0.0;
        if (camAbove && fragAbove) {
          airDist = atlasRayLen;
        } else if (camAbove && !fragAbove) {
          float tSurfFog = (waterLevel - atlasCamPos.y) / min(dirF.y, -1e-6);
          airDist = clamp(tSurfFog, 0.0, atlasRayLen);
        } else if (!camAbove && fragAbove) {
          float tSurfFog = (waterLevel - atlasCamPos.y) / max(dirF.y, 1e-6);
          airDist = clamp(atlasRayLen - max(tSurfFog, 0.0), 0.0, atlasRayLen);
        }

        float fogFac = airFogFactor(airDist, uAirFogDensity);
        vec3 fogCol = uAirFogColor;

        if (camAbove && fragAbove) {
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogCol, fogFac);
        } else if (camAbove && !fragAbove) {
          gl_FragColor.rgb = gl_FragColor.rgb * (vec3(1.0) - inScattering) + inScattering;
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogCol, fogFac);
        } else if (!camAbove && fragAbove) {
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogCol, fogFac);
          gl_FragColor.rgb = gl_FragColor.rgb * (vec3(1.0) - inScattering) + inScattering;
        } else {
          gl_FragColor.rgb = gl_FragColor.rgb * (vec3(1.0) - inScattering) + inScattering;
        }
          // gl_FragColor.rgb = normal.rgb * 0.5 + 0.5;
        `
      );

    console.log(ShaderChunk.normal_fragment_begin);
    console.log(ShaderChunk.normal_fragment_maps);

    shader.shaderName = "AtlasPointStandardMaterial";
  };
  material.name = "AtlasPointStandardMaterial";

  return material;
}
