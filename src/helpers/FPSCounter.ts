export default class FPSCounter {
  // FPS tracking DOM and state
  fpsFrameCount = 0;
  fpsLastTime = performance.now();
  fpsElement = document.getElementById("fps-counter");

  constructor() {}

  update() {
    const now = performance.now();
    this.fpsFrameCount++;

    // Update FPS once per second
    if (now - this.fpsLastTime >= 1000) {
      const elapsed = now - this.fpsLastTime;
      const fps = Math.round((this.fpsFrameCount * 1000) / elapsed);
      if (this.fpsElement) {
        this.fpsElement.textContent = `${fps} FPS`;
      }
      this.fpsFrameCount = 0;
      this.fpsLastTime = now;
    }
  }
}
