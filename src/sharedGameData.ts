import { Vector3 } from "three";

export const cloudScroll = new Vector3();
export const sunAngle = { value: 0.35 * Math.PI * 2 };
export const sunVector = new Vector3(Math.cos(sunAngle.value), Math.sin(sunAngle.value), 0);

export const auroraScroll = new Vector3();
export const auroraStrength = { value: 0 };
