// Mini Tobis with a character of their own. Every pill's Tobi is the same soft
// bean with the same eyes; what makes him that agent's Tobi is one small thing
// he wears or carries, in a tint of his body colour: a terminal chip for Claude
// Code, a halo for Codex, a monitor for Claude Desktop, pilot goggles for
// Copilot, cat ears for GitHub. A hint at the tool (shape, colour, object),
// never its logo.
//
// Everything is flat fills and strokes in the body's own space (the engine has
// already moved, tilted and squashed the canvas), so a persona turns and
// squashes with the bean. It adds no frame of its own: it is drawn inside the
// engine's draw(), on the island's one frame loop. While the pill works the
// object moves a little; with prefers-reduced-motion it stays still.

export interface PersonaPose {
  R: number;
  rx: number;
  ry: number;
  /** The body's turn, −1…1ish: head-top objects slide with it. */
  yaw: number;
  /** Seconds, 0 under prefers-reduced-motion. */
  t: number;
  /** Working, thinking or searching. */
  active: boolean;
  /** Tint of the body colour for the object, and the dark ink for its details. */
  hi: string;
  mid: string;
  ink: string;
}

type Draw = (x: CanvasRenderingContext2D, p: PersonaPose) => void;
interface Persona { back?: Draw; front?: Draw }

const TAU = Math.PI * 2;

// ── Small drawing helpers (units of R) ────────────────────────────────────────

function poly(x: CanvasRenderingContext2D, R: number, pts: readonly (readonly [number, number])[], fill: string) {
  x.beginPath();
  pts.forEach(([a, b], i) => (i === 0 ? x.moveTo(a * R, b * R) : x.lineTo(a * R, b * R)));
  x.closePath();
  x.fillStyle = fill;
  x.fill();
}

function disc(x: CanvasRenderingContext2D, R: number, cx: number, cy: number, r: number, fill: string) {
  x.beginPath();
  x.arc(cx * R, cy * R, Math.max(0.3, r * R), 0, TAU);
  x.fillStyle = fill;
  x.fill();
}

function oval(x: CanvasRenderingContext2D, R: number, cx: number, cy: number, rx: number, ry: number, rot: number, fill: string) {
  x.beginPath();
  x.ellipse(cx * R, cy * R, rx * R, ry * R, rot, 0, TAU);
  x.fillStyle = fill;
  x.fill();
}

function slab(x: CanvasRenderingContext2D, R: number, X: number, Y: number, W: number, H: number, r: number, fill: string) {
  const rad = Math.min(r, W / 2, H / 2) * R;
  const l = X * R, t = Y * R, w = W * R, h = H * R;
  x.beginPath();
  x.moveTo(l + rad, t);
  x.arcTo(l + w, t, l + w, t + h, rad);
  x.arcTo(l + w, t + h, l, t + h, rad);
  x.arcTo(l, t + h, l, t, rad);
  x.arcTo(l, t, l + w, t, rad);
  x.closePath();
  x.fillStyle = fill;
  x.fill();
}

function line(x: CanvasRenderingContext2D, R: number, pts: readonly (readonly [number, number])[], w: number, color: string) {
  x.beginPath();
  pts.forEach(([a, b], i) => (i === 0 ? x.moveTo(a * R, b * R) : x.lineTo(a * R, b * R)));
  x.strokeStyle = color;
  x.lineWidth = Math.max(0.8, w * R);
  x.lineCap = "round";
  x.lineJoin = "round";
  x.stroke();
}

/** Head-top objects slide a little with the body's turn. */
const slide = (p: PersonaPose) => Math.sin(p.yaw) * p.rx * 0.22;

/** 0…1 beat while working, else a slow breath. */
const beat = (p: PersonaPose, fast: number, slow = 0.6) => 0.5 + 0.5 * Math.sin(p.t * (p.active ? fast : slow));

// ── The cast ──────────────────────────────────────────────────────────────────

const PERSONAS: Record<string, Persona> = {
  // A terminal prompt on the forehead; the cursor blinks while he works.
  integration_claude: {
    front(x, p) {
      const { R } = p;
      x.save();
      x.translate(slide(p), 0);
      slab(x, R, -0.5, -0.9, 1.0, 0.44, 0.12, p.ink);
      line(x, R, [[-0.3, -0.82], [-0.16, -0.68], [-0.3, -0.54]], 0.07, p.hi);
      if (!p.active || Math.sin(p.t * 7) > -0.2) slab(x, R, -0.02, -0.57, 0.3, 0.07, 0.03, p.hi);
      x.restore();
    },
  },

  // A halo that floats above and bobs; it spins up a little while he works.
  agent_codex: {
    front(x, p) {
      const { R } = p;
      const bob = Math.sin(p.t * (p.active ? 4 : 1.6)) * 0.05;
      x.save();
      x.translate(slide(p), (-1.28 + bob) * R);
      x.beginPath();
      x.ellipse(0, 0, 0.5 * R, 0.17 * R, Math.sin(p.t * 1.2) * 0.06, 0, TAU);
      x.strokeStyle = p.hi;
      x.lineWidth = Math.max(1, 0.13 * R);
      x.stroke();
      x.restore();
    },
  },

  // A little desktop monitor perched on his head.
  "agent_claude-desktop": {
    front(x, p) {
      const { R } = p;
      x.save();
      x.translate(slide(p), 0);
      slab(x, R, -0.58, -1.5, 1.16, 0.74, 0.14, p.hi);
      slab(x, R, -0.47, -1.4, 0.94, 0.5, 0.08, p.ink);
      poly(x, R, [[-0.2, -0.76], [0.2, -0.76], [0.28, -0.62], [-0.28, -0.62]], p.hi);
      const on = beat(p, 6);
      slab(x, R, -0.32, -1.25, 0.64 * (p.active ? 0.4 + 0.6 * on : 0.55), 0.09, 0.04, p.mid);
      x.restore();
    },
  },

  // A mouse pointer stuck in his head; it presses down while he works.
  agent_cursor: {
    front(x, p) {
      const { R } = p;
      const press = p.active ? Math.max(0, Math.sin(p.t * 6)) * 0.08 : 0;
      x.save();
      x.translate(slide(p) + 0.05 * R, (-0.86 + press) * R);
      x.rotate(-0.28);
      poly(x, R, [[0, -0.62], [0.42, 0.04], [0.15, 0.03], [0.3, 0.38], [0.14, 0.45], [0, 0.1], [-0.2, 0.28]].map(([a, b]) => [a, b - 0.12] as [number, number]), p.hi);
      x.restore();
    },
  },

  // Pebbles that float around above him: gravity is optional.
  agent_antigravity: {
    back(x, p) {
      const { R } = p;
      for (let i = 0; i < 3; i++) {
        const a = p.t * (p.active ? 2.6 : 0.9) + (i * TAU) / 3;
        disc(x, R, Math.cos(a) * 0.78 + slide(p) / R, -1.25 + Math.sin(a) * 0.16, 0.11 + 0.03 * i, p.hi);
      }
    },
  },

  // Twins: two buds on thin stems, one lighter, that nod in turn.
  agent_gemini: {
    back(x, p) {
      const { R } = p;
      const s = slide(p) / R;
      for (const [sd, fill] of [[-1, p.hi], [1, p.mid]] as const) {
        const nod = Math.sin(p.t * (p.active ? 5 : 1.8) + (sd < 0 ? 0 : Math.PI)) * 0.07;
        line(x, R, [[sd * 0.3 + s, -0.8], [sd * 0.46 + s, -1.08 + nod]], 0.07, fill);
        disc(x, R, sd * 0.46 + s, -1.2 + nod, 0.2, fill);
      }
    },
  },

  // Pilot goggles pushed up on the forehead.
  agent_copilot: {
    front(x, p) {
      const { R } = p;
      x.save();
      x.translate(slide(p), 0);
      slab(x, R, -0.88, -0.78, 1.76, 0.14, 0.05, p.ink);
      for (const sd of [-1, 1]) {
        disc(x, R, sd * 0.34, -0.71, 0.3, p.ink);
        disc(x, R, sd * 0.34, -0.71, 0.2, p.hi);
        const glint = p.active ? Math.sin(p.t * 5) * 0.04 : 0;
        disc(x, R, sd * 0.34 - 0.06 + glint, -0.77, 0.06, "#fff");
      }
      x.restore();
    },
  },

  // A painter's beret with its stalk.
  agent_muse: {
    front(x, p) {
      const { R } = p;
      x.save();
      x.translate(slide(p) + 0.1 * R, -0.92 * R);
      x.rotate(-0.16);
      oval(x, R, 0, -0.08, 0.8, 0.34, 0, p.hi);
      oval(x, R, 0.06, 0.1, 0.62, 0.12, 0, p.mid);
      line(x, R, [[0, -0.4], [Math.sin(p.t * (p.active ? 7 : 2)) * 0.05, -0.56]], 0.1, p.hi);
      x.restore();
    },
  },

  // A sprout: open source, growing.
  agent_opencode: {
    back(x, p) {
      const { R } = p;
      const sway = Math.sin(p.t * (p.active ? 4 : 1.4)) * 0.12;
      x.save();
      x.translate(slide(p), -0.88 * R);
      x.rotate(sway);
      line(x, R, [[0, 0.1], [0, -0.32]], 0.09, p.hi);
      oval(x, R, -0.22, -0.4, 0.25, 0.12, -0.5, p.hi);
      oval(x, R, 0.22, -0.46, 0.25, 0.12, 0.5, p.hi);
      x.restore();
    },
  },

  // A bolt: amplified. It flickers while he works.
  agent_amp: {
    front(x, p) {
      const { R } = p;
      const k = p.active ? 0.9 + 0.2 * beat(p, 9) : 1;
      x.save();
      x.translate(slide(p), -1.22 * R);
      x.scale(k, k);
      poly(x, R, [[0.12, -0.5], [-0.3, 0.06], [-0.04, 0.06], [-0.16, 0.5], [0.3, -0.12], [0.04, -0.12]], p.hi);
      x.restore();
    },
  },

  // The messenger: small wings that flap faster when he runs.
  agent_hermes: {
    back(x, p) {
      const { R, rx } = p;
      const flap = Math.sin(p.t * (p.active ? 13 : 2.2)) * (p.active ? 0.32 : 0.1);
      for (const sd of [-1, 1]) {
        x.save();
        x.translate(sd * rx * 0.86, -0.3 * R);
        x.rotate(sd * (-0.4 + flap));
        oval(x, R, sd * 0.3, -0.04, 0.38, 0.15, sd * -0.1, p.hi);
        oval(x, R, sd * 0.26, 0.17, 0.3, 0.12, sd * 0.2, p.mid);
        x.restore();
      }
    },
  },

  // Cat ears.
  integration_github: {
    back(x, p) {
      const { R } = p;
      const flick = p.active ? Math.max(0, Math.sin(p.t * 6)) * 0.06 : 0;
      for (const sd of [-1, 1]) {
        poly(x, R, [[sd * 0.9, -0.5], [sd * 0.78, -1.32 - (sd > 0 ? flick : 0)], [sd * 0.16, -0.92]], p.hi);
        poly(x, R, [[sd * 0.74, -0.7], [sd * 0.7, -1.1], [sd * 0.38, -0.88]], p.mid);
      }
    },
  },

  // Fox ears, taller and set wider.
  integration_gitlab: {
    back(x, p) {
      const { R } = p;
      const perk = p.active ? Math.sin(p.t * 5) * 0.05 : 0;
      for (const sd of [-1, 1]) {
        poly(x, R, [[sd * 1.0, -0.4], [sd * 0.74, -1.5 + perk], [sd * 0.1, -0.94]], p.hi);
        poly(x, R, [[sd * 0.8, -0.72], [sd * 0.72, -1.2 + perk], [sd * 0.34, -0.92]], p.ink);
      }
    },
  },

  // A teacup with a curl of steam; the steam rises faster while he works.
  integration_gitea: {
    front(x, p) {
      const { R } = p;
      x.save();
      x.translate(slide(p), 0);
      poly(x, R, [[-0.42, -1.1], [0.42, -1.1], [0.32, -0.8], [-0.32, -0.8]], p.hi);
      line(x, R, [[0.4, -1.04], [0.62, -1.0], [0.5, -0.86]], 0.07, p.hi);
      for (const dx of [-0.14, 0.14]) {
        const rise = (p.t * (p.active ? 1.4 : 0.5) + dx) % 1;
        x.globalAlpha = 1 - rise * 0.8;
        line(x, R, [[dx - 0.04, -1.2 - rise * 0.22], [dx + 0.05, -1.32 - rise * 0.22], [dx - 0.03, -1.42 - rise * 0.22]], 0.06, p.hi);
      }
      x.globalAlpha = 1;
      x.restore();
    },
  },

  // A letter in the mail, flap and all.
  integration_gmail: {
    front(x, p) {
      const { R } = p;
      x.save();
      x.translate(slide(p), 0);
      slab(x, R, -0.6, -1.4, 1.2, 0.74, 0.1, p.hi);
      line(x, R, [[-0.56, -1.34], [0, -0.96], [0.56, -1.34]], 0.08, p.ink);
      x.restore();
    },
  },

  // A postman's flat cap.
  integration_mail: {
    front(x, p) {
      const { R } = p;
      x.save();
      x.translate(slide(p), 0);
      x.beginPath();
      x.ellipse(0, -0.92 * R, 0.82 * R, 0.5 * R, 0, Math.PI, 0);
      x.closePath();
      x.fillStyle = p.hi;
      x.fill();
      slab(x, R, -0.2, -0.98, 0.98, 0.14, 0.07, p.mid);
      disc(x, R, 0, -1.2, 0.07, p.mid);
      x.restore();
    },
  },

  // A paper plane on his head that takes off a little when he is busy.
  integration_telegram: {
    front(x, p) {
      const { R } = p;
      const lift = p.active ? Math.sin(p.t * 4) * 0.08 : Math.sin(p.t * 1.4) * 0.03;
      x.save();
      x.translate(slide(p), (-1.2 + lift) * R);
      x.rotate(-0.3);
      poly(x, R, [[-0.62, -0.1], [0.66, -0.3], [-0.1, 0.34]], p.hi);
      poly(x, R, [[-0.1, 0.34], [-0.16, 0.0], [0.66, -0.3]], p.mid);
      x.restore();
    },
  },

  // A speech bubble with three dots that jump while he chats.
  integration_whatsapp: {
    front(x, p) {
      const { R } = p;
      x.save();
      x.translate(slide(p), 0);
      slab(x, R, -0.15, -1.52, 1.1, 0.7, 0.3, p.hi);
      poly(x, R, [[0.1, -0.84], [0.0, -0.58], [0.3, -0.84]], p.hi);
      for (let i = 0; i < 3; i++) {
        const up = p.active ? Math.max(0, Math.sin(p.t * 8 - i * 0.9)) * 0.08 : 0;
        disc(x, R, 0.1 + i * 0.3 - 0.05, -1.17 - up, 0.07, p.ink);
      }
      x.restore();
    },
  },

  // Equaliser bars on top.
  integration_spotify: {
    front(x, p) {
      const { R } = p;
      x.save();
      x.translate(slide(p), 0);
      for (let i = -1; i <= 1; i++) {
        const h = 0.26 + 0.2 * (p.active ? beat({ ...p, t: p.t + i * 1.1 }, 9) : 0.4 + 0.1 * i);
        slab(x, R, i * 0.3 - 0.1, -1.0 - h, 0.2, h, 0.08, p.hi);
      }
      x.restore();
    },
  },

  // A record on its edge behind his head; it spins while it plays.
  integration_youtubemusic: {
    back(x, p) {
      const { R } = p;
      const spin = p.t * (p.active ? 3 : 0.6);
      x.save();
      x.translate(slide(p), -1.0 * R);
      disc(x, R, 0, 0, 0.62, p.hi);
      x.beginPath();
      x.arc(0, 0, 0.42 * R, 0, TAU);
      x.strokeStyle = p.mid;
      x.lineWidth = Math.max(0.6, 0.05 * R);
      x.stroke();
      disc(x, R, 0, 0, 0.17, p.ink);
      disc(x, R, Math.cos(spin) * 0.5, Math.sin(spin) * 0.5, 0.06, p.ink);
      x.restore();
    },
  },

  // A mortarboard: the one that learned everything.
  ai_anthropic: {
    front(x, p) {
      const { R } = p;
      x.save();
      x.translate(slide(p), 0);
      poly(x, R, [[0, -1.5], [0.86, -1.18], [0, -0.88], [-0.86, -1.18]], p.hi);
      slab(x, R, -0.36, -1.0, 0.72, 0.2, 0.06, p.mid);
      line(x, R, [[0.7, -1.2], [0.74, -0.84]], 0.05, p.hi);
      x.restore();
    },
  },

  // A headband with four dots.
  ai_google: {
    front(x, p) {
      const { R } = p;
      x.save();
      x.translate(slide(p), 0);
      slab(x, R, -0.84, -0.86, 1.68, 0.16, 0.06, p.hi);
      ["#4285F4", "#EA4335", "#FBBC05", "#34A853"].forEach((c, i) => disc(x, R, -0.5 + i * 0.33, -0.78, 0.1, c));
      x.restore();
    },
  },

  // A curl of hair that winds up.
  ai_openai: {
    front(x, p) {
      const { R } = p;
      x.save();
      x.translate(slide(p), -1.0 * R);
      x.beginPath();
      const turn = p.active ? p.t * 2 : 0;
      for (let i = 0; i <= 28; i++) {
        const a = i * 0.34 + turn;
        const r = (0.05 + i * 0.012) * R;
        const px = Math.cos(a) * r * 1.4, py = -0.24 * R + Math.sin(a) * r;
        if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
      }
      x.strokeStyle = p.hi;
      x.lineWidth = Math.max(1, 0.1 * R);
      x.lineCap = "round";
      x.stroke();
      x.restore();
    },
  },

  // Llama ears, tall.
  ai_ollama: {
    back(x, p) {
      const { R } = p;
      const twitch = p.active ? Math.sin(p.t * 7) * 0.12 : 0;
      for (const sd of [-1, 1]) {
        x.save();
        x.translate(sd * 0.42 * R, -0.8 * R);
        x.rotate(sd * (0.18 + (sd > 0 ? twitch : 0)));
        oval(x, R, 0, -0.42, 0.17, 0.5, 0, p.hi);
        oval(x, R, 0, -0.36, 0.08, 0.3, 0, p.mid);
        x.restore();
      }
    },
  },

  // An antenna with a ball that pulses.
  ai_lmstudio: {
    front(x, p) {
      const { R } = p;
      x.save();
      x.translate(slide(p), 0);
      line(x, R, [[0, -0.9], [0.04, -1.24]], 0.08, p.hi);
      disc(x, R, 0.04, -1.34, 0.15 + 0.05 * beat(p, 7), p.hi);
      x.restore();
    },
  },

  // A party cone with a pom.
  integration_vercel: {
    front(x, p) {
      const { R } = p;
      x.save();
      x.translate(slide(p) + 0.04 * R, 0);
      x.rotate(0.1);
      poly(x, R, [[0, -1.62], [0.5, -0.82], [-0.5, -0.82]], p.hi);
      line(x, R, [[-0.3, -1.12], [0.3, -1.02]], 0.07, p.mid);
      disc(x, R, 0, -1.64, 0.1, p.mid);
      x.restore();
    },
  },

  // A striped headband that slides while he works.
  integration_stripe: {
    front(x, p) {
      const { R } = p;
      x.save();
      x.translate(slide(p), 0);
      slab(x, R, -0.86, -0.88, 1.72, 0.24, 0.08, p.hi);
      const off = p.active ? (p.t * 0.5) % 0.34 : 0;
      x.save();
      x.beginPath();
      x.rect(-0.86 * R, -0.88 * R, 1.72 * R, 0.24 * R);
      x.clip();
      for (let i = -1; i < 6; i++) {
        const sx = -0.86 + i * 0.34 + off;
        poly(x, R, [[sx, -0.64], [sx + 0.12, -0.64], [sx + 0.3, -0.88], [sx + 0.18, -0.88]], p.ink);
      }
      x.restore();
      x.restore();
    },
  },

  // A little graph of nodes, the way a workflow looks.
  integration_n8n: {
    front(x, p) {
      const { R } = p;
      const s = slide(p) / R;
      line(x, R, [[-0.34 + s, -1.0], [0 + s, -1.3], [0.34 + s, -1.0]], 0.06, p.hi);
      disc(x, R, -0.34 + s, -1.0, 0.13, p.hi);
      disc(x, R, 0.34 + s, -1.0, 0.13, p.hi);
      disc(x, R, s, -1.3, 0.14 + 0.04 * beat(p, 8), p.hi);
    },
  },

  // A calendar page clipped to his head.
  integration_calcom: {
    front(x, p) {
      const { R } = p;
      x.save();
      x.translate(slide(p), 0);
      slab(x, R, -0.4, -1.42, 0.8, 0.7, 0.1, p.hi);
      slab(x, R, -0.4, -1.42, 0.8, 0.2, 0.1, p.ink);
      for (const dx of [-0.2, 0, 0.2]) disc(x, R, dx, -0.98, 0.06, p.ink);
      x.restore();
    },
  },

  // A pencil tucked in beside the head.
  integration_notion: {
    front(x, p) {
      const { R } = p;
      x.save();
      x.translate(0.62 * R, -0.98 * R);
      x.rotate(0.5 + (p.active ? Math.sin(p.t * 9) * 0.1 : 0));
      slab(x, R, -0.08, -0.5, 0.16, 0.7, 0.04, p.hi);
      poly(x, R, [[-0.08, 0.2], [0.08, 0.2], [0, 0.4]], p.mid);
      x.restore();
    },
  },

  // A bow tie, for the one that sends.
  integration_resend: {
    front(x, p) {
      const { R } = p;
      const sw = p.active ? Math.sin(p.t * 6) * 0.04 : 0;
      poly(x, R, [[0, 0.98], [-0.42, 0.78 + sw], [-0.42, 1.18 - sw]], p.hi);
      poly(x, R, [[0, 0.98], [0.42, 0.78 - sw], [0.42, 1.18 + sw]], p.hi);
      disc(x, R, 0, 0.98, 0.1, p.mid);
    },
  },
};

// ── Entry points ──────────────────────────────────────────────────────────────

/** True when the pill has a character of its own (else the engine keeps Tobi's headphones). */
export const hasPersona = (id: string | null | undefined): boolean => id != null && id in PERSONAS;

export const personaIds = (): string[] => Object.keys(PERSONAS);

let reducedQuery: MediaQueryList | null | undefined;

/** prefers-reduced-motion, read once and kept current. */
export function reducedMotion(): boolean {
  if (reducedQuery === undefined) {
    reducedQuery = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  }
  return reducedQuery?.matches ?? false;
}

export function drawPersonaBehind(x: CanvasRenderingContext2D, id: string, p: PersonaPose) {
  const draw = PERSONAS[id]?.back;
  if (draw && p.R >= 4) { x.save(); draw(x, p); x.restore(); }
}

export function drawPersonaFront(x: CanvasRenderingContext2D, id: string, p: PersonaPose) {
  const draw = PERSONAS[id]?.front;
  if (draw && p.R >= 4) { x.save(); draw(x, p); x.restore(); }
}
