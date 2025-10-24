precision lowp float;
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec3 vUvw;
uniform sampler2D uTexture;

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

float poww(float v) {
  float inv = (1.0 - v);
  float s = sign(v);
  return (1.0 - (inv * inv)) * s;
}
float poww2(float v) {
  float inv = (1.0 - v);
  return (1.0 - (inv * inv * inv * inv));
}

void main() {
  #include <logdepthbuf_fragment>

  float noiseSample = noise(vUvw * 100000.0) * 0.5 + 0.5;
  noiseSample *= noiseSample;

  vec2 uvc = vUvw.xy * 2.0 - 1.0;
  uvc = vec2(1.0)-pow(vec2(1.0)-uvc, vec2(9.5));
  gl_FragColor = texture2D( uTexture, (uvc / mix(1.0, 0.9, noiseSample)) * 0.5 + 0.5 ) * vec4(0.1, 1.0, 0.0, 1.0);
  gl_FragColor += texture2D( uTexture, (uvc / mix(1.0, 0.8, noiseSample)) * 0.5 + 0.5 ) * vec4(0.5, 0.9, 0.25, 1.0);
  gl_FragColor += texture2D( uTexture, (uvc / mix(1.0, 0.6, noiseSample)) * 0.5 + 0.5 ) * vec4(1.0, 0.5, 0.5, 1.0);
  gl_FragColor += texture2D( uTexture, (uvc / mix(1.0, 0.4, noiseSample)) * 0.5 + 0.5 ) * vec4(1.0, 0.1, 0.25, 1.0);
  gl_FragColor += texture2D( uTexture, (uvc / mix(1.0, 0.2, noiseSample)) * 0.5 + 0.5 ) * vec4(1.0, 0.0, 0.0, 1.0);
  gl_FragColor *= 0.15;

  #include <colorspace_fragment>
}
