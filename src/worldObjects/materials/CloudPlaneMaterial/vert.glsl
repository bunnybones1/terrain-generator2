precision highp float;
#include <common>
uniform vec3 uScroll;

varying vec3 vUvw;

#include <logdepthbuf_pars_vertex>

void main() {
  gl_Position = projectionMatrix * (modelViewMatrix * vec4(position, 1.0));
  vUvw = (vec3(uv.x, uv.y, 0.0)) * 100.0 + vec3(uScroll);
  #include <logdepthbuf_vertex>
}