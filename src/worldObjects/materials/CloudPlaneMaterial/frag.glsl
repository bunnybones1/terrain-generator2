precision lowp float;

varying vec2 vUv;

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

void main() {
  vec3 uvw1a = vec3(vUv.x * 5.0, vUv.y * 4.0, vUv.y * 5.0);
  vec3 uvw1b = vec3(vUv.x * 5.0, 0.8, vUv.y * 5.0);
  float disortX = noise(uvw1a);
  float disortY = noise(uvw1b);
  vec3 uvw2 = vec3((vUv.x+disortX) * 30.0, -20.0, (vUv.y+disortY) * 30.0);
  vec3 uvw3 = vec3((vUv.x+disortX) * 100.0, 17.5, (vUv.y+disortY) * 100.0);
  vec3 uvw4 = vec3((vUv.x) * 300.0, -27.0, (vUv.y) * 300.0);
  vec3 uvw5 = vec3((vUv.x) * 900.0, -127.0, (vUv.y) * 900.0);
  vec3 uvw6 = vec3((vUv.x) * 1900.0, 127.0, (vUv.y) * 1900.0);
  float noiseSample = noise(uvw2);
  noiseSample += noise(uvw3);
  noiseSample += noise(uvw4);
  noiseSample += noise(uvw5) * 0.5;
  noiseSample += noise(uvw6) * 0.35;
  noiseSample *= 0.25;
  float cloudStr = max(0.0, noiseSample - 0.45);
  gl_FragColor = mix(vec4(3.0, 3.0, 3.0, 0.0), vec4(-3.0, -2.0, 0.0, 2.0), cloudStr);
}
