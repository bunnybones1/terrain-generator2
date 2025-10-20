import FirstPersonController from "../FirstPersonController";
import Flashlight from "../worldObjects/Flashlight";

export default function initKeyboardShortcuts(
  firstPersonController: FirstPersonController,
  flashlight: Flashlight
) {
  window.addEventListener("keydown", (e) => {
    if (e.key === "[" || e.key === "{") {
      // decrease dig radius nonlinearly; bigger digs change faster
      const r0 = firstPersonController.digRadius;
      const step = Math.max(0.5, Math.min(10, r0 * 0.15)); // 15% of current size, min 0.5, max 10
      let r = Math.max(0.5, r0 - step);
      // rounding rule: <=10 -> nearest 0.5m, >10 -> nearest 1m
      if (r <= 10) {
        r = Math.round(r * 2) / 2;
      } else {
        r = Math.round(r);
      }
      // clamp
      r = Math.max(0.5, Math.min(500, r));
      firstPersonController.digRadius = r;
      const span = document.getElementById("dig-radius");
      if (span) span.textContent = `${firstPersonController.digRadius}`;
    } else if (e.key === "]" || e.key === "}") {
      // increase dig radius nonlinearly; bigger digs change faster
      const r0 = firstPersonController.digRadius;
      const step = Math.max(0.5, Math.min(10, r0 * 0.15)); // 15% of current size, min 0.5, max 10
      let r = Math.min(500, r0 + step);
      // rounding rule: <=10 -> nearest 0.5m, >10 -> nearest 1m
      if (r <= 10) {
        r = Math.round(r * 2) / 2;
      } else {
        r = Math.round(r);
      }
      // clamp
      r = Math.max(0.5, Math.min(500, r));
      firstPersonController.digRadius = r;
      const span = document.getElementById("dig-radius");
      if (span) span.textContent = `${firstPersonController.digRadius}`;
    } else if (e.key.toLowerCase() === "l") {
      // toggle flashlight
      flashlight.toggle();
    }
  });
}
