import { Color } from "three";

export const sunColorDefault = new Color(1000, 900, 600);
export const sunColor = sunColorDefault.clone();
export const sunColorForEnvMap = sunColorDefault.clone();

export const worldColorTop = new Color(0.3, 0.5, 1);
export const worldColorBottomDefault = new Color(0.4, 0.25, 0.1);
export const worldColorBottom = worldColorBottomDefault.clone();
export const cloudColor = worldColorTop.clone();
export const fogColor = worldColorTop;
const wcScale = 2;
export const waterColorDefault = new Color(0.05 * wcScale, 0.2 * wcScale, 0.2 * wcScale);
export const waterColor = waterColorDefault.clone();
