import { PMREMGenerator, Texture } from "three";

export default class CustomPMREMGenerator extends PMREMGenerator {
  heldCubeUVRenderTarget: Texture | undefined;
  _allocateTargets() {
    if (!this.heldCubeUVRenderTarget) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      //@ts-ignore
      this.heldCubeUVRenderTarget = super._allocateTargets();
    }
    return this.heldCubeUVRenderTarget;
  }
}
