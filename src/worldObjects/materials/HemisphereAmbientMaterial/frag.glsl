precision lowp float;
#include <common>
#include <logdepthbuf_pars_fragment>

varying vec4 vColor;

void main() {
  #include <logdepthbuf_fragment>
  gl_FragColor = vColor;
  #include <colorspace_fragment>
}
