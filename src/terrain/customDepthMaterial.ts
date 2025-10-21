import { ShaderLib, ShaderMaterial, UniformsUtils } from "three";
import { POWER_SHADOWS, POWER_SHADOWS_POWER } from "../overrides";

// Build a custom depth material based on three's chunks so we can customize shadow caster output
export function makeCustomDepthMaterial() {
  // Start from built-in depth shader
  const base = ShaderLib.depth;
  const uniforms = UniformsUtils.clone(base.uniforms);

  // Optional: add your custom uniforms here
  // uniforms.uMyFactor = { value: 1.0 };
  // console.log(ShaderChunk.project_vertex)

  // Compose shaders with standard chunks and hooks for customization
  const vertexShader = `
    precision highp float;
    #define DEPTH_PACKING ${0}
    #include <common>
    #include <uv_pars_vertex>
    #include <displacementmap_pars_vertex>
    #include <morphtarget_pars_vertex>
    #include <skinning_pars_vertex>
    #include <logdepthbuf_pars_vertex>
    #include <clipping_planes_pars_vertex>

    void main() {
      #include <uv_vertex>
      #include <beginnormal_vertex>
      #include <morphnormal_vertex>
      #include <skinbase_vertex>
      #include <skinnormal_vertex>
      #include <defaultnormal_vertex>

      #include <begin_vertex>
      #include <morphtarget_vertex>
      #include <skinning_vertex>
      #include <displacementmap_vertex>
      // Custom vertex modifications can be inserted here
      #include <project_vertex>

      
      #include <logdepthbuf_vertex>
      #include <clipping_planes_vertex>
      ${
        POWER_SHADOWS
          ? `
      //collapse for UV in shadow mapper of terrain material
      vec2 tmp = gl_Position.xy;
      tmp = (vec2(1.0) - pow(vec2(1.0) - abs(tmp), vec2(${POWER_SHADOWS_POWER}))) * sign(tmp);
      gl_Position.xy = tmp;`
          : ``
      }
    }
  `;

  const fragmentShader = `
    precision highp float;
    #define DEPTH_PACKING ${0}
    #include <common>
    #include <packing>
    #include <uv_pars_fragment>
    #include <map_pars_fragment>
    #include <alphamap_pars_fragment>
    #include <alphatest_pars_fragment>
    #include <specularmap_pars_fragment>
    #include <logdepthbuf_pars_fragment>
    #include <clipping_planes_pars_fragment>

    void main() {
      #include <clipping_planes_fragment>
      #include <logdepthbuf_fragment>

      float fragCoordZ = gl_FragCoord.z;

      // Apply alpha test and maps if present
      vec4 diffuseColor = vec4(1.0);
      #include <map_fragment>
      #include <alphamap_fragment>
      #include <alphatest_fragment>

      // Customizable hook: you can modify fragCoordZ or diffuseColor.a here

      gl_FragColor = packDepthToRGBA( fragCoordZ);
    }
  `;

  const customDepthMaterial = new ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    depthTest: true,
    depthWrite: true,
    clipping: true,
    skinning: true,
    morphTargets: true,
    morphNormals: true,
  });

  // Assign to directional light shadow caster
  return customDepthMaterial;
}
