precision highp float;

#include <common>

uniform vec3 uColorTop;
uniform vec3 uColorBottom;
uniform vec3 uColorFog;
varying vec4 vColor;

#include <logdepthbuf_pars_vertex>

void main() {
  gl_Position = projectionMatrix * (modelViewMatrix * vec4(position, 1.0));
  vColor = vec4(mix(uColorBottom, uColorTop, clamp(position.y*8.0,-1.0, 1.0) * 0.5 + 0.5), 1.0);
  float h = 1.0-abs(position.y);
  vColor.rgb = mix(vColor.rgb, uColorFog, h*h*h*h * 0.75);
  #include <logdepthbuf_vertex>
}