precision highp float;
#include <common>
#include <logdepthbuf_pars_vertex>

varying vec3 vUvw;


void main() {
  gl_Position = projectionMatrix * (modelViewMatrix * vec4(position, 1.0));
  vUvw = vec3(uv * 0.5 + 0.5, 1.0 - length(uv));
  #include <logdepthbuf_vertex>
}