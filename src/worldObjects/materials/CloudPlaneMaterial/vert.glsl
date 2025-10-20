precision highp float;

attribute vec4 position;
attribute vec2 uv;
uniform vec3 uScroll;

uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;

varying vec3 vUvw;

void main() {
  gl_Position = projectionMatrix * (modelViewMatrix * position);
  vUvw = (vec3(uv.x, uv.y, uv.x - uv.y) + uScroll) * vec3(50.0);
}