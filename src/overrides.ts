export const AMBIENT_LIGHT_MODE: "hemi" | "probes" | "envmap" = "envmap";
export const POWER_SHADOWS = true;
export const POWER_SHADOWS_POWER = `10.5`;

// Toggle this constant to enable/disable overdraw test mode.
// Changing it will re-run onBeforeCompile and recompile the shader because of defines changes.
export const OVERDRAW_TEST = false;
