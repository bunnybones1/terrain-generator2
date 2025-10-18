import {
  Vector2,
  MeshStandardMaterial,
  Color,
  Vector3,
  Vector4,
  AdditiveBlending,
  Texture,
} from "three";
import { loadTex } from "./loadTex";
import { ProbeManager } from "../lighting/ProbeManager";
import { OVERDRAW_TEST } from "../overrides";

export function makeTerrainMaterial(
  cameraPosition: Vector3,
  envMap?: Texture,
  probeManager?: ProbeManager
) {
  // Textures
  const grassTex = loadTex("textures/grass.png");
  const rockTex = loadTex("textures/rocks.png");
  const snowTex = loadTex("textures/snow.png");
  const sandTex = loadTex("textures/sand.png");
  const pineTex = loadTex("textures/pineneedles.png");
  const grassNormalsTex = loadTex("textures/grass-normals.png");
  const rockNormalsTex = loadTex("textures/rocks-normals.png");
  const snowNormalsTex = loadTex("textures/snow-normals.png");
  const sandNormalsTex = loadTex("textures/sand-normals.png");
  const pineNormalsTex = loadTex("textures/pineneedles-normals.png");

  // Base material
  const mat = new MeshStandardMaterial({
    map: grassTex,
    normalMap: grassNormalsTex,
    metalness: 0,
    roughness: 0.6,
    envMap: envMap,
    envMapIntensity: 0.2,
    // wireframe: true,
  });

  // Make material additive and transparent in overdraw mode
  if (OVERDRAW_TEST) {
    // mat.transparent = true;
    mat.blending = AdditiveBlending;
    mat.depthTest = true;
    mat.depthWrite = true;
  }

  const tiling = new Vector2(1, 1);
  if (mat.map) {
    mat.map.repeat.copy(tiling);
    mat.map.needsUpdate = true;
  }

  mat.onBeforeCompile = (shader) => {
    // Inject define for overdraw test
    shader.defines = shader.defines || {};
    if (OVERDRAW_TEST) {
      shader.defines.OVERDRAW_TEST = 1;
    }

    // Enable probe usage only when probeManager exists
    if (probeManager) {
      shader.defines.USE_PROBES = 1;
    }

    // Packed uniforms
    shader.uniforms.uRock = { value: rockTex };
    shader.uniforms.uSnow = { value: snowTex };
    shader.uniforms.uSand = { value: sandTex };
    shader.uniforms.uPine = { value: pineTex };
    shader.uniforms.uRockNormal = { value: rockNormalsTex };
    shader.uniforms.uSnowNormal = { value: snowNormalsTex };
    shader.uniforms.uSandNormal = { value: sandNormalsTex };
    shader.uniforms.uPineNormal = { value: pineNormalsTex };

    // Tiling base and per-layer scale (x: base tiling.x, y: base tiling.y, z: unused)
    shader.uniforms.uTiling = { value: tiling };
    // Per-layer tiling scales for rock, snow, sand
    shader.uniforms.uTilingScales = { value: new Vector3(1.23, 7.95, 2.5) };

    // Slope threshold and band
    shader.uniforms.uSlope = { value: new Vector2(0.5, 0.002) }; // x=threshold, y=band

    // Snow controls packed:
    // uSnowPack: x=elevationStart, y=elevationEnd, z=band, w=thresholdStart
    shader.uniforms.uSnowPack = { value: new Vector4(108.5, 256.05, 0.01, 0.85) };
    // uSnowThresholdEnd separate to keep vec4 usage minimal? pack into uSnowExtra: x=thresholdEnd
    shader.uniforms.uSnowExtra = { value: new Vector2(0.65, 0.0) };

    // Sand controls packed: x=height, y=band
    shader.uniforms.uSandPack = { value: new Vector2(10.0, 1.0) };

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
    const wcScale = 2;
    shader.uniforms.uWaterColor = {
      value: new Color(0.05 * wcScale, 0.2 * wcScale, 0.2 * wcScale),
    };

    // Air fog
    shader.uniforms.uAirFogColor = { value: new Color(0.9, 0.9, 1.0) };
    shader.uniforms.uAirFogDensity = { value: 0.0002 };

    // UV de-repetition defaults
    shader.uniforms.uUvWarpStrength = { value: 0.15 }; // in UV space (~texels if textures repeat 1)
    shader.uniforms.uUvNoiseFreq = { value: 0.002 }; // world-space frequency
    shader.uniforms.uUvShuffleScale = { value: 0.5 }; // fewer than 1 means larger tiles shuffled
    shader.uniforms.uUvRotateJitter = { value: 6.28 }; // radians

    // Ensure camera position is available
    shader.uniforms.cameraPosition = shader.uniforms.cameraPosition || {
      value: cameraPosition,
    };

    if (probeManager) {
      shader.uniforms.uProbeAtlas = { value: probeManager.getAtlasTexture() };
      shader.uniforms.uProbeShared = {
        value: probeManager.getSharedLayoutConfig(),
      };
    }

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `
        #include <common>
        varying float vHeight;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        // Pine tint varying from geometry attribute
        attribute float pine;
        varying float vPine;

        // Inverse ambient occlusion (x) and trunk mask (y)
        attribute vec2 invAOAndMask;
        varying float vInvAO;
        varying float vTrunkMask;

        // Per-instance ambient occlusion (0..1)
        attribute float instanceInvAO;
        varying float vInstanceInvAO;
        `
      )
      .replace(
        "#include <begin_vertex>",
        `
        #include <begin_vertex>
        // Build the correct object-to-world matrix that accounts for instancing
        mat4 objToWorld = modelMatrix;
        #ifdef USE_INSTANCING
          objToWorld = modelMatrix * instanceMatrix;
        #endif

        // World position and height
        vec3 worldPos = (objToWorld * vec4(transformed, 1.0)).xyz;
        vHeight = worldPos.y;
        vWorldPos = worldPos;

        // Derive world normal using the same transform (no translation)
        vec3 nObj = normal;
        vec3 nWorld = normalize((objToWorld * vec4(nObj, 0.0)).xyz);
        vWorldNormal = nWorld;

        // Pass pine attribute (0..1)
        vPine = pine;

        // Pass inverse AO and trunk mask
        vInvAO = invAOAndMask.x;
        vTrunkMask = invAOAndMask.y;

        // Pass per-instance AO
        vInstanceInvAO = instanceInvAO;
        `
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `
        #include <common>
        varying float vPine;
        varying float vInvAO;
        varying float vTrunkMask;
        varying float vInstanceInvAO;
        uniform sampler2D uRock;
        uniform sampler2D uSnow;
        uniform sampler2D uSand;
        uniform sampler2D uPine;
        uniform sampler2D uRockNormal;
        uniform sampler2D uSnowNormal;
        uniform sampler2D uSandNormal;
        uniform sampler2D uPineNormal;

        uniform vec2 uTiling;
        uniform vec3 uTilingScales;

        uniform vec2 uSlope;          // x=threshold, y=band
        uniform vec4 uSnowPack;       // x=elevStart, y=elevEnd, z=band, w=threshStart
        uniform vec2 uSnowExtra;      // x=threshEnd
        uniform vec2 uSandPack;       // x=height, y=band

        uniform vec4 uWaterAbsorbPack;// x=level, y=absorbR, z=absorbG, w=scatterR
        uniform vec4 uWaterScatterPack;// xyz=scatterRGB
        uniform vec3 uWaterColor;

        uniform vec3 uAirFogColor;
        uniform float uAirFogDensity;

        // Indirect lighting probes
        uniform sampler2D uProbeAtlas;
        // shared layout: [texelsPerProbe, probesPerAxis, probesPerLevel, texelsPerLevel, totalLevels, atlasSize, baseSpacing]
        uniform float uProbeShared[7];

        // Final world-space normal after normal map blending
        vec3 finalWorldNormal;

        // Compute spacing for a given level directly from shared config
        float levelSpacing(int level) {
          float baseSpacing = uProbeShared[6];
          return baseSpacing * pow(2.0, float(level));
        }

        // Sample atlas at integer texel coordinates
        vec3 sampleAtlas(vec2 px) {
          float atlasSize = uProbeShared[5];
          vec2 uv = (px + 0.5) / vec2(atlasSize);
          return texture2D(uProbeAtlas, uv).rgb;
        }

        // Map a global 1D texel index into 2D pixel coords (row-major across full width)
        vec2 texelIndexToPixel(int texelIndex) {
          int aSize = int(uProbeShared[5]);
          int x = texelIndex % aSize;
          int y = texelIndex / aSize;
          // Clamp to valid pixel range to avoid bleeding into adjacent rows/levels
          x = clamp(x, 0, aSize - 1);
          y = clamp(y, 0, aSize - 1);
          return vec2(float(x), float(y));
        }

        // Fetch a single probe at 3D integer indices mapped into the 2D atlas using flat 1D packing
        vec3 readProbeAtIndex3D(int ix, int iy, int iz, int level) {
          int texelsPerProbe = int(uProbeShared[0]);
          int probesPerAxis = int(uProbeShared[1]);
          int texelsPerLevel = int(uProbeShared[3]);

          // Correct flatten: iy*(N*N) + iz*N + ix
          int N = probesPerAxis;
          int flatIndexInLevel = (iy * N * N) + (iz * N) + ix;

          // Convert to global 1D texel start index using per-level base offset
          int baseTexel = texelsPerLevel * level;
          int texelIndexStart = baseTexel + flatIndexInLevel * texelsPerProbe;

          // Sample the first texel of the probe (RGB packed irradiance)
          vec2 p = texelIndexToPixel(texelIndexStart);
          return sampleAtlas(p);
        }

        // Trilinear sampling with wrapping ring-buffer indices
        vec3 sampleProbeLevel3D(vec3 worldPos, int level) {
          float totalLevels = uProbeShared[4];
          if (level >= int(totalLevels)) return vec3(0.0);

          int probesPerAxis = int(uProbeShared[1]);

          float spacing = levelSpacing(level);
          float invSpacing = 1.0 / max(spacing, 1e-6);

          // world to cell coordinates
          float fx = floor(worldPos.x * invSpacing);
          float fy = floor(worldPos.y * invSpacing);
          float fz = floor(worldPos.z * invSpacing);

          float tx = fract(worldPos.x * invSpacing);
          float ty = fract(worldPos.y * invSpacing);
          float tz = fract(worldPos.z * invSpacing);

          int ix0 = int(mod(fx, float(probesPerAxis))); if (ix0 < 0) ix0 += probesPerAxis;
          int iy0 = int(mod(fy, float(probesPerAxis))); if (iy0 < 0) iy0 += probesPerAxis;
          int iz0 = int(mod(fz, float(probesPerAxis))); if (iz0 < 0) iz0 += probesPerAxis;

          int ix1 = (ix0 + 1) % probesPerAxis;
          int iy1 = (iy0 + 1) % probesPerAxis;
          int iz1 = (iz0 + 1) % probesPerAxis;

          // sample 8 neighbors
          vec3 c000 = readProbeAtIndex3D(ix0, iy0, iz0, level);
          vec3 c100 = readProbeAtIndex3D(ix1, iy0, iz0, level);
          vec3 c010 = readProbeAtIndex3D(ix0, iy1, iz0, level);
          vec3 c110 = readProbeAtIndex3D(ix1, iy1, iz0, level);
          vec3 c001 = readProbeAtIndex3D(ix0, iy0, iz1, level);
          vec3 c101 = readProbeAtIndex3D(ix1, iy0, iz1, level);
          vec3 c011 = readProbeAtIndex3D(ix0, iy1, iz1, level);
          vec3 c111 = readProbeAtIndex3D(ix1, iy1, iz1, level);

          // trilinear blend
          vec3 c00 = mix(c000, c100, tx);
          vec3 c01 = mix(c001, c101, tx);
          vec3 c10 = mix(c010, c110, tx);
          vec3 c11 = mix(c011, c111, tx);

          vec3 c0 = mix(c00, c10, ty);
          vec3 c1 = mix(c01, c11, ty);

          return mix(c0, c1, tz);
        }

        vec3 sampleIndirectIrradiance(vec3 worldPos) {
          float dist = length(worldPos - cameraPosition);
          // Compute level from distance using powers of two thresholds starting at 16m
          float baseEdge = 16.0;
          float totalLevels = uProbeShared[4];
          float lod = clamp(log2(max(dist, 1e-6) / baseEdge), 0.0, totalLevels - 1.0);
          float lvl0F = floor(lod);
          int lvl0 = int(lvl0F);
          int lvl1 = min(lvl0 + 1, int(totalLevels) - 1);
          float t = clamp(lod - lvl0F, 0.0, 1.0);
          // Optional smoothing to reduce banding
          // t = t * t * (3.0 - 2.0 * t);

          vec3 a = sampleProbeLevel3D(worldPos, lvl0);
          vec3 b = sampleProbeLevel3D(worldPos, lvl1);
          return mix(a, b, t);
        }

        varying float vHeight;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;

        // UV de-repetition controls
        uniform float uUvWarpStrength;   // how much to warp the uv (in texels)
        uniform float uUvNoiseFreq;      // low-frequency noise for warp
        uniform float uUvShuffleScale;   // scale to hash-based shuffle
        uniform float uUvRotateJitter;   // small rotation jitter amount (radians)

        // Small hash / noise helpers (cheap)
        float hash11(float p) {
          p = fract(p * 0.1031);
          p *= p + 33.33;
          p *= p + p;
          return fract(p);
        }
        float hash21(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }
        vec2 hash22(vec2 p) {
          float n = hash21(p);
          float m = hash21(p + 37.2);
          return vec2(n, m);
        }

        // Value noise (single octave) based on world pos to drive UV warp
        float noise2(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          float a = hash21(i);
          float b = hash21(i + vec2(1.0, 0.0));
          float c = hash21(i + vec2(0.0, 1.0));
          float d = hash21(i + vec2(1.0, 1.0));
          vec2 u = f*f*(3.0-2.0*f);
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }

        // Warp and shuffle uv to break repetition
        vec2 warpUv(vec2 uv, vec3 worldPos) {
          // Low-freq warp via worldPos
          float n = noise2(worldPos.xz * uUvNoiseFreq);
          vec2 dir = normalize(vec2(0.87, 0.49));
          uv += dir * (n - 0.5) * uUvWarpStrength;

          // Stochastic tile shuffle: pick per-tile offset/rotation using a hash of floor coords
          vec2 tileId = floor(uv * uUvShuffleScale);
          vec2 jitter = hash22(tileId) - 0.5;
          float angle = (hash21(tileId + 11.3) - 0.5) * 2.0 * uUvRotateJitter;

          // apply small rotation around tile center
          vec2 centerUv = (fract(uv * uUvShuffleScale) - 0.5);
          float s = sin(angle), c = cos(angle);
          vec2 rot = mat2(c, -s, s, c) * centerUv;
          uv = (rot + 0.5 + jitter * (1.0 / max(uUvShuffleScale, 0.0001))) / uUvShuffleScale;

          return uv;
        }

        float unlerp(float a, float b, float v) {
          return clamp((v - a) / max(b - a, 1e-5), 0.0, 1.0);
        }

        float bandstep(float center, float band, float v) {
          return smoothstep(center - band, center + band, v);
        }

        vec2 rockSnowSandTiling(vec2 uv) {
          return uv * uTiling;
        }

        vec3 waterAbsorptionFactor(float depth) {
          float d = max(depth, 0.0);
          vec3 k = vec3(uWaterAbsorbPack.y, uWaterAbsorbPack.z, max(uWaterAbsorbPack.z * 0.5, 0.01));
          return exp(-k * d);
        }

        vec3 waterBackscatter(vec3 sigma_s, vec3 waterColor, float L) {
          float len = max(L, 0.0);
          return waterColor * (vec3(1.0) - exp(-sigma_s * len));
        }

        float airFogFactor(float distance, float density) {
          float d = max(distance, 0.0);
          return clamp(1.0 - exp(-density * d), 0.0, 1.0);
        }

        vec3 downwellingAttenuation(float camDepth) {
          float d = max(camDepth, 0.0);
          vec3 k = vec3(uWaterAbsorbPack.y, uWaterAbsorbPack.z, max(uWaterAbsorbPack.z * 0.5, 0.01));
          return exp(-k * d);
        }
        `
      )
      .replace(
        "#include <map_fragment>",
        `
        #ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D( map, vMapUv * uTiling );
          diffuseColor *= sampledDiffuseColor;
        #endif

        vec2 uvBase = vMapUv * uTiling;

        // Apply UV warp and stochastic shuffle per layer to break repetition
        vec2 uvRock = warpUv(uvBase * uTilingScales.x, vWorldPos + vec3(13.1,0.0,7.7));
        vec2 uvSnow = warpUv(uvBase * uTilingScales.y, vWorldPos + vec3(2.3,0.0,19.9));
        vec2 uvSand = warpUv(uvBase * uTilingScales.z, vWorldPos + vec3(31.7,0.0,3.1));
        vec2 uvPine = warpUv(uvBase * uTilingScales.x, vWorldPos + vec3(17.3,0.0,9.1)); // reuse rock scale as default

        vec3 rockSample = texture2D( uRock, uvRock ).rgb;
        vec3 snowSample = texture2D( uSnow, uvSnow ).rgb;
        vec3 sandSample = texture2D( uSand, uvSand ).rgb;
        vec3 pineSample = texture2D( uPine, uvPine ).rgb;

        vec3 baseAlbedo = diffuseColor.rgb;

        // Sand blend
        float tSand = 1.0 - smoothstep(uSandPack.x - uSandPack.y, uSandPack.x + uSandPack.y, vHeight);
        vec3 albedoGS = mix(baseAlbedo, sandSample, tSand);

        // Derive slope from world-space normal: s = sqrt(1 - ny^2)
        float ny = clamp(vWorldNormal.y, -1.0, 1.0);
        float slope = sqrt(max(0.0, 1.0 - ny * ny));

        // Rock by slope
        float tRock = bandstep(uSlope.x, uSlope.y, slope);
        // Allow rock when pine coverage is low: enable if vPine < 0.2
        float rockEnable = 1.0 - step(0.2, vPine); // 1 when vPine < 0.2, 0 when >= 0.2
        tRock *= rockEnable;
        vec3 albedoGSR = mix(albedoGS, rockSample, tRock);

        // Snow: appear on tops first; as elevation increases, allow snow on steeper slopes.
        float heightFactor = unlerp(uSnowPack.x, uSnowPack.y, vHeight);

        // slope in [0,1]: 0 is flat/up, 1 is vertical
        // Use a maximum allowable slope for snow that increases with height
        float maxSlopeLow  = 0.2; // near-flat at low elevation
        float maxSlopeHigh = 0.8; // can be fairly steep at high elevation
        float maxSlope = mix(maxSlopeLow, maxSlopeHigh, heightFactor);

        // Convert to a flatness target: higher when flat
        float flatness = 1.0 - slope;

        // Threshold on flatness that relaxes with height
        float flatThresh = 1.0 - maxSlope; // at low height, ~0.8; at high height, ~0.3
        float band = uSnowPack.z;
        float tFlat = bandstep(flatThresh, band, flatness);

        // Combine with height to fade in with elevation
        float tSnow = clamp(tFlat * heightFactor, 0.0, 1.0);

        // Keep weights in scope: tSand, tRock, tSnow
        diffuseColor.rgb = mix(albedoGSR, snowSample, tSnow);

        // Mix pine texture based on per-vertex pine attribute
        float pineAmt = clamp(vPine * 100.0, 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, pineSample, pineAmt);
        `
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#ifdef USE_NORMALMAP_OBJECTSPACE
          normal = texture2D( normalMap, vNormalMapUv * uTiling ).xyz * 2.0 - 1.0;
          #ifdef FLIP_SIDED
            normal = - normal;
          #endif
          #ifdef DOUBLE_SIDED
            normal = normal * faceDirection;
          #endif
          normal = normalize( normalMatrix * normal );
          finalWorldNormal = normal;
        #elif defined( USE_NORMALMAP_TANGENTSPACE )
          vec3 baseTangentNormal = vec3(0.0, 0.0, 1.0);
          #ifdef USE_NORMALMAP
            baseTangentNormal = normalize(texture2D( normalMap, vNormalMapUv * uTiling ).xyz * 2.0 - 1.0);
          #endif

          vec2 uvNBase = vNormalMapUv * uTiling;
          vec3 rockTangentNormal = normalize(texture2D( uRockNormal, warpUv(uvNBase * uTilingScales.x, vWorldPos + vec3(13.1,0.0,7.7)) ).xyz * 2.0 - 1.0);
          vec3 snowTangentNormal = normalize(texture2D( uSnowNormal, warpUv(uvNBase * uTilingScales.y, vWorldPos + vec3(2.3,0.0,19.9)) ).xyz * 2.0 - 1.0);
          vec3 sandTangentNormal = normalize(texture2D( uSandNormal, warpUv(uvNBase * uTilingScales.z, vWorldPos + vec3(31.7,0.0,3.1)) ).xyz * 2.0 - 1.0);
          vec3 pineTangentNormal = normalize(texture2D( uPineNormal, warpUv(uvNBase * uTilingScales.x, vWorldPos + vec3(17.3,0.0,9.1)) ).xyz * 2.0 - 1.0);

          // Reuse previously computed weights from albedo stage directly
          vec3 nGS = normalize( mix(baseTangentNormal, sandTangentNormal, tSand) );
          float rockEnableN = 1.0 - step(0.2, vPine); // enable normals when vPine < 0.2
          vec3 nGSR = normalize( mix(nGS, rockTangentNormal, tRock * rockEnableN) );
          vec3 nGSRSnow = normalize( mix(nGSR, snowTangentNormal, clamp(tSnow, 0.0, 1.0)) );
          vec3 blendedTangentNormal = normalize( mix(nGSRSnow, pineTangentNormal, clamp(vPine, 0.0, 1.0)) );
          blendedTangentNormal.xy *= normalScale;

          vec3 mapN = blendedTangentNormal;
          normal = normalize( tbn * mapN );
          finalWorldNormal = normal;
        #elif defined( USE_BUMPMAP )
          normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
          finalWorldNormal = normal;
        #endif`
      )
      .replace(
        `#include <lights_physical_fragment>`,
        `

        vec3 camPosF = cameraPosition;
        vec3 toFragF = vWorldPos - camPosF;
        float dist = length(toFragF);

        roughnessFactor = mix(roughnessFactor, 0.2, tSand);
        // specularIntensity = mix(specularIntensity, 0.3, tSand);
        roughnessFactor = mix(roughnessFactor, 0.4, tSnow);
        roughnessFactor = mix(roughnessFactor, 1.0, pineAmt);
        #include <lights_physical_fragment>`
      )
      .replace(
        `#include <lights_fragment_begin>`,
        `
        #include <lights_fragment_begin>
        
        #ifdef USE_PROBES
        // Indirect lighting from probe atlas
        // vec3 probePos = vWorldPos;
        // vec3 probePos = vWorldPos + normal * 4.0;
        vec3 probePos = vWorldPos + (vWorldNormal + mapN) * 4.0;
        vec3 irr = sampleIndirectIrradiance(probePos);
        irradiance += irr;
        #endif
        `
      )
      .replace(
        `#include <lights_fragment_end>`,
        `
        #include <lights_fragment_end>


        // // Indirect lighting from probe atlas
        // // vec3 probePos = vWorldPos;
        // vec3 probePos = vWorldPos + (vWorldNormal + mapN) * 4.0;
        // vec3 irr = sampleIndirectIrradiance(probePos);
        // irradiance += irr;
        // // reflectedLight.indirectDiffuse += irr;
        vec3 sandSpec = vec3(mix(1.0, 10.0/dist, tSand));
        float ao = 1.0 - vInvAO;
        // Combine with per-instance AO (treat value as an additional multiplier; default 0 -> no change)
        float instAO = clamp(1.0 - vInstanceInvAO, 0.0, 1.0);
        // ao *= instAO;
        // ao *= instAO * vTrunkMask;
        ao *= mix(instAO, 1.0, vTrunkMask);

        float ao2 = ao * ao;
        float aoCustom = ao2 * 0.75 + 0.12;
        vec3 aoGreen = vec3(mix(ao, aoCustom, 0.5), aoCustom, ao);
        // aoGreen = vec3(vTrunkMask);
        reflectedLight.directDiffuse *= aoGreen;
        reflectedLight.indirectDiffuse *= aoGreen;
        reflectedLight.directSpecular *= sandSpec * aoGreen;
        reflectedLight.indirectSpecular *= sandSpec * aoGreen;

        `
      )
      .replace(
        "#include <fog_fragment>",
        `

        // Compute underwater segment length along the view ray
        vec3 camPos = cameraPosition;
        vec3 toFrag = vWorldPos - camPos;
        float rayLen = length(toFrag);
        vec3 rayDir = (rayLen > 0.0) ? toFrag / max(rayLen, 1e-6) : vec3(0.0, -1.0, 0.0);

        float waterLevel = uWaterAbsorbPack.x;
        float camY = camPos.y;
        float fragY = vWorldPos.y;

        float waterSeg = 0.0;
        float denom = rayDir.y;

        if (abs(denom) < 1e-6) {
          // Ray parallel to water plane: underwater if both endpoints are below
          if (camY < waterLevel && fragY < waterLevel) {
            waterSeg = rayLen;
          } else {
            waterSeg = 0.0;
          }
        } else {
          float tHit = (waterLevel - camY) / denom; // param where ray hits the plane
          bool camUnder = camY < waterLevel;
          bool fragUnder = fragY < waterLevel;

          if (camUnder && fragUnder) {
            // Entire segment underwater
            waterSeg = rayLen;
          } else if (!camUnder && !fragUnder) {
            // Entire segment above water
            waterSeg = 0.0;
          } else {
            // Crosses the surface once; clamp intersection within segment
            float t = clamp(tHit, 0.0, rayLen);
            if (camUnder && !fragUnder) {
              // underwater from camera to surface
              waterSeg = t;
            } else if (!camUnder && fragUnder) {
              // underwater from surface to fragment
              waterSeg = max(rayLen - t, 0.0);
            }
          }
        }

        // Apply water absorption along only the underwater portion
        vec3 k = vec3(uWaterAbsorbPack.y, uWaterAbsorbPack.z, max(uWaterAbsorbPack.z * 0.5, 0.01));
        vec3 transmittance = exp(-k * max(waterSeg, 0.0));

        // Apply water color filtering to reflected light for submerged fragments with white at surface and increasing with depth
        float fragDepthBelow = max(waterLevel - fragY, 0.0);
        if (fragDepthBelow > 0.0) {
          // Depth factor in [0,1]: 0 at surface, approaching 1 with depth based on blue-leaning absorption
          float depthFactor = 1.0 - exp(-uWaterAbsorbPack.z * fragDepthBelow);
          vec3 attenDown = downwellingAttenuation(fragDepthBelow) * uWaterColor;
          vec3 waterFilter = mix(vec3(1.0), attenDown, depthFactor);
          transmittance *= waterFilter;
        }
        
        // Water backscatter for the underwater portion of the view ray
        float camDepthBelow = max(waterLevel - camY, 0.0);
        vec3 attenColor = uWaterColor * downwellingAttenuation(camDepthBelow);
        vec3 inScattering = waterBackscatter(uWaterScatterPack.xyz, attenColor, waterSeg);


        vec3 dirF = (dist > 0.0) ? toFragF / dist : vec3(0.0);

        bool camAbove = camPosF.y >= uWaterAbsorbPack.x;
        bool fragAbove = vWorldPos.y >= uWaterAbsorbPack.x;

        float airDist = 0.0;
        if (camAbove && fragAbove) {
          airDist = dist;
        } else if (camAbove && !fragAbove) {
          float tSurfFog = (uWaterAbsorbPack.x - camPosF.y) / min(dirF.y, -1e-6);
          airDist = clamp(tSurfFog, 0.0, dist);
        } else if (!camAbove && fragAbove) {
          float tSurfFog = (uWaterAbsorbPack.x - camPosF.y) / max(dirF.y, 1e-6);
          airDist = clamp(dist - max(tSurfFog, 0.0), 0.0, dist);
        }

        float fogFac = airFogFactor(airDist, uAirFogDensity);
        vec3 fogCol = uAirFogColor;

        if (camAbove && fragAbove) {
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogCol, fogFac);
        } else if (camAbove && !fragAbove) {
          gl_FragColor.rgb *= transmittance;
          gl_FragColor.rgb += inScattering;
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogCol, fogFac);
        } else if (!camAbove && fragAbove) {
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogCol, fogFac);
          gl_FragColor.rgb *= transmittance;
          gl_FragColor.rgb += inScattering;
        } else {
          gl_FragColor.rgb *= transmittance;
          gl_FragColor.rgb += inScattering;
        }
          // gl_FragColor.rgb = tbn * 0.5 + 0.5;
          // gl_FragColor.rgb = (tbn * vWorldNormal) * 0.5 + 0.5;
          // gl_FragColor.rgb = (vWorldNormal + mapN) * 0.5 + 0.5;
          // gl_FragColor.rgb = mapN * 0.5 + 0.5;

          // normal = normalize( tbn * mapN );

        #ifdef OVERDRAW_TEST
          // Output a dark gray to visualize overdraw, with additive blending
          gl_FragColor.rgb = vec3(0.1);
          gl_FragColor.a = 1.0;
        #endif
        `
      );
  };

  return mat;
}
