// Tobi's look: one place for the shape and colours every drawing of him shares
// (engine.ts, outfits.ts, upload/canvas.ts, scripts/gen-icons.mjs keeps a copy).
//
// Tobi is a honey-coloured bean with a dark visor across his face, glowing eyes
// behind it and a little antenna whose light takes the colour of what he is doing.

/** Body radii as a fraction of R, and the superellipse exponent (2 = ellipse). */
export const BODY_RX = 1.0;
export const BODY_RY = 0.96;
export const BODY_EXP = 2.2;

/** Body gradient, top-right → bottom-left. */
export const BODY_TOP = "rgb(255,231,163)"; // #FFE7A3
export const BODY_BOTTOM = "rgb(242,184,75)"; // #F2B84B
export const BODY_TOP_RGB = [1, 0.906, 0.639] as const;
export const BODY_BOTTOM_RGB = [0.949, 0.722, 0.294] as const;

/** The visor and the eyes behind it. */
export const VISOR_TOP = "rgb(38,42,54)"; // #262A36
export const VISOR_BOTTOM = "rgb(14,16,22)"; // #0E1016
export const EYE_GLOW = "rgb(236,248,255)"; // #ECF8FF
export const EYE_GLOW_RGB = [0.925, 0.973, 1] as const;

/** The antenna light when nothing is going on. */
/** The antenna stalk: dark honey, visible on the black island and on light themes. */
export const STALK = "rgb(201,138,40)"; // #C98A28
export const ANTENNA_IDLE_RGB = [1, 0.478, 0.239] as const; // #FF7A3D
