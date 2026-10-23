// Tobi's look: one place for the shape and colours every drawing of him shares
// (engine.ts, greeting.ts, outfits.ts, upload/canvas.ts).
//
// Tobi is a soft white bean with big glossy black eyes, a little smile and blue
// headphones; the headphones take the colour of what he is doing.

/** Body radii as a fraction of R, and the superellipse exponent (2 = ellipse). */
export const BODY_RX = 1.0;
export const BODY_RY = 0.96;
export const BODY_EXP = 2.2;

/** Body gradient, top-right → bottom-left. */
export const BODY_TOP = "rgb(255,255,255)";
export const BODY_BOTTOM = "rgb(205,213,246)"; // #CDD5F6
export const BODY_TOP_RGB = [1, 1, 1] as const;
export const BODY_BOTTOM_RGB = [0.804, 0.835, 0.965] as const;

/** The eyes: glossy black with a white highlight. */
export const EYE_INK = "rgb(18,14,24)";
export const MOUTH_INK = "rgb(48,12,24)";
export const MOUTH_TONGUE = "rgb(190,52,66)";

/** The headphones, top → bottom, and as a colour to mix the state's into. */
export const PHONE_TOP = "rgb(46,168,255)"; // #2EA8FF
export const PHONE_BOTTOM = "rgb(8,92,232)"; // #085CE8
export const PHONE_RGB = [0.1, 0.5, 1] as const;
