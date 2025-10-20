import FirstPersonController from "../FirstPersonController";
import Flashlight from "../worldObjects/Flashlight";
import { updateUIDigRadius } from "./ui/updateUIDigRadius";

function stepDigRadius(initValue: number, stepDir: number) {
  const step = Math.max(0.5, Math.min(10, initValue * 0.15)); // 15% of current size, min 0.5, max 10
  let r = Math.max(0.5, initValue + step * stepDir);
  // rounding rule: <=10 -> nearest 0.5m, >10 -> nearest 1m
  if (r <= 10) {
    r = Math.round(r * 2) / 2;
  } else {
    r = Math.round(r);
  }
  // clamp
  r = Math.max(0.5, Math.min(500, r));
  return r;
}

export default function initKeyboardShortcuts(
  firstPersonController: FirstPersonController,
  flashlight: Flashlight
) {
  window.addEventListener("keydown", (e) => {
    if (e.key === "[" || e.key === "{") {
      // decrease dig radius nonlinearly; bigger digs change faster
      firstPersonController.digRadius = stepDigRadius(firstPersonController.digRadius, -1);
      updateUIDigRadius(firstPersonController.digRadius);
    } else if (e.key === "]" || e.key === "}") {
      // increase dig radius nonlinearly; bigger digs change faster
      firstPersonController.digRadius = stepDigRadius(firstPersonController.digRadius, 1);
      updateUIDigRadius(firstPersonController.digRadius);
    } else if (e.key.toLowerCase() === "l") {
      // toggle flashlight
      flashlight.toggle();
    }
  });
}
