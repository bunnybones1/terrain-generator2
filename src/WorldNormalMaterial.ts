import { ShaderMaterial } from "three";

/**
 * Creates a ShaderMaterial that writes world-space normals encoded in [0,1].
 * Uses standard Three.js shader chunks so it works with InstancedMesh and engine features.
 */
export function createWorldNormalMaterial() {
  const material = new ShaderMaterial({
    vertexShader: `
    #define NORMAL
      #if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
        varying vec3 vViewPosition;
      #endif
      varying vec3 vWorldNormal;
      #include <common>
      #include <batching_pars_vertex>
      #include <uv_pars_vertex>
      #include <displacementmap_pars_vertex>
      #include <normal_pars_vertex>
      #include <morphtarget_pars_vertex>
      #include <skinning_pars_vertex>
      #include <logdepthbuf_pars_vertex>
      #include <clipping_planes_pars_vertex>
      void main() {
        #include <uv_vertex>
        #include <batching_vertex>
        #include <beginnormal_vertex>
        #include <morphinstance_vertex>
        #include <morphnormal_vertex>
        #include <skinbase_vertex>
        #include <skinnormal_vertex>
        #include <defaultnormal_vertex>
        #include <normal_vertex>
        #include <begin_vertex>
        #include <morphtarget_vertex>
        #include <skinning_vertex>
        #include <displacementmap_vertex>
        #include <project_vertex>
        #include <logdepthbuf_vertex>
        #include <clipping_planes_vertex>
      #if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
        vViewPosition = - mvPosition.xyz;
      #endif
        // transformedNormal is in view space after <normal_vertex>. Convert to world space.
        vWorldNormal = normalize( inverseTransformDirection( transformedNormal, viewMatrix ) );
    }
    `,
    fragmentShader: `
    #define NORMAL
    uniform float opacity;
    varying vec3 vWorldNormal;
    #if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
      varying vec3 vViewPosition;
    #endif
    #include <packing>
    #include <uv_pars_fragment>
    #include <normal_pars_fragment>
    #include <bumpmap_pars_fragment>
    #include <normalmap_pars_fragment>
    #include <logdepthbuf_pars_fragment>
    #include <clipping_planes_pars_fragment>
    void main() {
      vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
      #include <clipping_planes_fragment>
      #include <logdepthbuf_fragment>
      #include <normal_fragment_begin>
      #include <normal_fragment_maps>
      gl_FragColor = vec4( packNormalToRGB( vWorldNormal ), diffuseColor.a );
      #ifdef OPAQUE
        gl_FragColor.a = 1.0;
      #endif
    }
    `,
    // Ensure compatibility flags typical for standard materials
    lights: false,
    fog: true,
    clipping: true,
    depthWrite: true,
    transparent: false,
  });
  return material;
}
