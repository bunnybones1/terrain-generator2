import { Vector3 } from "three";
import { TIME_SPEED_DEFAULT } from "./overrides";

export const cloudScroll = new Vector3();
export const worldTime = { value: 0.35 * Math.PI * 2 };
export const timeBoost = { value: 0 };
export const sunVector = new Vector3(Math.cos(worldTime.value), Math.sin(worldTime.value), 0);

export const auroraScroll = new Vector3();
export const auroraStrength = { value: 0 };

export const timeSpeed = { value: TIME_SPEED_DEFAULT };
