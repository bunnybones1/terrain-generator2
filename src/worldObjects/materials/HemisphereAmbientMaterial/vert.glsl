precision highp float;

attribute vec4 position;

uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;

uniform vec3 uColorTop;
uniform vec3 uColorBottom;
uniform vec3 uColorFog;
varying vec4 vColor;

void main() {
  gl_Position = projectionMatrix * (modelViewMatrix * position);
  vColor = vec4(mix(uColorBottom, uColorTop, clamp(position.y*8.0,-1.0, 1.0) * 0.5 + 0.5), 1.0);
  float h = 1.0-abs(position.y);
  vColor.rgb = mix(vColor.rgb, uColorFog, h*h*h*h * 0.75);
}