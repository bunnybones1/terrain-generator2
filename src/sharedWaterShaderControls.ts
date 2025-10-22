import { Color, Vector4 } from "three";

// uWaterAbsorbPack: x=level, y=absorbR, z=absorbG, w=scatterR
const wapScale = 0.25;
export const waterAbsorbPackDefault = new Vector4(0.0, 0.22, 0.08, 0.02).multiplyScalar(wapScale);

// uWaterScatterPack: xyz=scatterRGB, w=unused (backscatter uses xyz)
const wspScale = 0.25;
export const waterScatterPackDefault = new Vector4(0.02, 0.03, 0.08, 0.0).multiplyScalar(wspScale);

const wcScale = 2;
export const waterColorDefault = new Color(0.05 * wcScale, 0.2 * wcScale, 0.2 * wcScale);

waterAbsorbPackDefault.multiplyScalar(1 / 0.7);
waterScatterPackDefault.multiplyScalar(1 / 1.5);
// Brighten via power curve: exponent < 1 (e.g., 0.5 = sqrt). Adjust to taste.
const brightenExponent = 0.5;
waterColorDefault
  .setRGB(
    Math.pow(waterColorDefault.r, brightenExponent) * 0.8,
    Math.pow(waterColorDefault.g, brightenExponent),
    Math.pow(waterColorDefault.b, brightenExponent) * 1.1
  )
  .multiplyScalar(1 / 0.9);

export const waterAbsorbPack = waterAbsorbPackDefault.clone();
export const waterScatterPack = waterScatterPackDefault.clone();
export const waterColor = waterColorDefault.clone();
