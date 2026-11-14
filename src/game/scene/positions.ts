// Where the scene's pieces go. Pure TypeScript with no Pixi import, so it runs under `node --test`.
// Written by Claude Code.
//
// Positions come from the original Main.unity (canvas centre origin, y up) converted to playfield px (top-left origin,
// y down): playfield = (250 + x, 250 − y). The converted numbers are kept as they were. Draw order follows the
// original's sortingOrder, back to front:
// - world: WORLD_SPRITES, in table order, with WORLD_EFFECTS (rain, splashes, bubbles, eyes) drawn in.
// - fx: the lightning bolt `Raio` (−2), the black overlay `TelaPreta` and the vignette (−1), the white flash (0).
// - top: the text box (0), cursors (0), arrows (1), the title logo (15).
// - ui (CSS px): story text, the challenge prompt and its progress, the tap prompt and the credits.
import type { SpriteKey } from "../../assets/manifest.ts";
import { PLAYFIELD_SIZE, type Point } from "../../core/layout.ts";
import { VOICE_GREY } from "../story/script.ts";
import { WHITE } from "./palette.ts";

export interface WorldSprite {
  readonly label: string;
  readonly key: SpriteKey;
  /** Where the sprite's anchor goes, in playfield px (then snapped onto the art grid). */
  readonly at: Point;
  /** The original's sortingOrder, for reference: the table is already in that order. */
  readonly sortingOrder: number;
}

/**
 * The world layer, back to front: array order is draw order. Stage/Background holds the backdrops at canvas
 * (9.6, −29); the kraken is Stage/Monster at (−8, −9). The sea strips, the clouds and the boat play their ambient loops
 * from the first frame (world.ts): their rows hold the loops' first poses. Stage/Sky carries two cloud sprites, the
 * second 500 px right of the first, scrolled in as the first scrolls out.
 */
export const WORLD_SPRITES = [
  { label: "tentacles", key: "backgroundTentacles", at: { x: 255.6, y: 279 }, sortingOrder: -30 },
  { label: "pillars", key: "backgroundPillars", at: { x: 256.6, y: 279 }, sortingOrder: -29 },
  // The sea strips at their clips' first x (SeaAnim*, −25 from the anchor).
  { label: "seaB", key: "seaB", at: { x: 225, y: 389 }, sortingOrder: -25 },
  { label: "kraken-tail", key: "monsterB", at: { x: 362, y: 254 }, sortingOrder: -19 },
  // On whole art pixels, the original's 309.5 is 310 (see layers.ts).
  { label: "boat", key: "boat", at: { x: 250, y: 310 }, sortingOrder: -16 },
  { label: "seaM", key: "seaM", at: { x: 225, y: 399 }, sortingOrder: -15 },
  { label: "clouds", key: "clouds", at: { x: 250, y: 73 }, sortingOrder: -10 },
  { label: "clouds-2", key: "clouds", at: { x: 750, y: 73 }, sortingOrder: -10 },
  { label: "kraken-body", key: "monsterA", at: { x: 216, y: 239 }, sortingOrder: -9 },
  { label: "seaF", key: "seaF", at: { x: 225, y: 409 }, sortingOrder: -5 },
  // Barco Quebrado: its sprite sits 35 below the object, at canvas (0, −44).
  { label: "broken-boat", key: "boatFlipped", at: { x: 250, y: 294 }, sortingOrder: -2 },
] as const satisfies readonly WorldSprite[];

export type WorldSpriteLabel = (typeof WORLD_SPRITES)[number]["label"];

export interface WorldEffect {
  readonly label: string;
  /** The WORLD_SPRITES row it is drawn just behind. */
  readonly before: WorldSpriteLabel;
  /**
   * The original's sortingOrder, for reference only: nothing reads it to draw (`before` places it), and
   * positions.test.ts checks it agrees with `before`.
   */
  readonly sortingOrder: number;
}

/**
 * The particle systems and the eyes (scene/particles), each drawn just behind a WORLD_SPRITES row; rows sharing one
 * keep this order (m5-particles-spec §5). The splashes (−10) sit behind the kraken's body and the front sea strip,
 * which hides the lower half of each hop; the rain (−6) falls behind the front strip, so a drop's tail tucks under its
 * surface; the bubbles and the eyes (−4) rise over it, under the broken boat.
 */
export const WORLD_EFFECTS = [
  { label: "splash", before: "kraken-body", sortingOrder: -10 },
  { label: "rain", before: "seaF", sortingOrder: -6 },
  { label: "bubbles", before: "broken-boat", sortingOrder: -4 },
  { label: "eye-small", before: "broken-boat", sortingOrder: -4 },
  { label: "eye-large", before: "broken-boat", sortingOrder: -4 },
] as const satisfies readonly WorldEffect[];

export type WorldEffectLabel = (typeof WORLD_EFFECTS)[number]["label"];

/** The world layer's children, back to front: WORLD_SPRITES with WORLD_EFFECTS drawn in. */
export const WORLD_ORDER: readonly (WorldSpriteLabel | WorldEffectLabel)[] = WORLD_SPRITES.flatMap(({ label }) => [
  ...WORLD_EFFECTS.filter((effect) => effect.before === label).map((effect) => effect.label),
  label,
]);

/** The playfield's centre: where the vignette sits. */
export const PLAYFIELD_CENTER: Point = { x: PLAYFIELD_SIZE / 2, y: PLAYFIELD_SIZE / 2 };

/** Main.unity scales the vignette to 1.05, so its dark rim sits just outside the square. */
export const VIGNETTE_SCALE = 1.05;

/** `UI/Title/Logo`: canvas (0, 35). */
export const LOGO_AT: Point = { x: 250, y: 215 };

/**
 * The arrow row (`UI/ArrowSpot`, canvas y −160). KeyManager spawns arrow i at world x `−⌊n/2⌋·0.2 + i·0.2` (integer
 * division, so an even row sat half a step right; the original only had odd rows). The port centres every row (owner
 * decision, endless mode's even rows): arrow i at `(i − (n − 1) / 2)` steps from the centre. The canvas is Screen
 * Space – Camera on an orthographic camera of size 1, scaled to match a 500-unit reference width: on the square canvas
 * the camera sees 2 world units across 500 canvas units, so 0.2 world units are 50 canvas px. (On a wider window the
 * original's spacing shrank to 50 / aspect; the port keeps the square's.) 7 arrows span x 100–400, 112 to 388 with
 * their 24 px art: they fit the 500 px playfield with room to spare.
 */
export const ARROW_ROW: Point = { x: PLAYFIELD_SIZE / 2, y: PLAYFIELD_SIZE / 2 + 160 };
export const ARROW_SPACING = 50;
/** The cursor under each arrow (KeyManager: local y −35). */
export const CURSOR_OFFSET = 35;

/** The x of arrow `index` in a row of `count`, in playfield px. */
export const arrowX = (index: number, count: number) => ARROW_ROW.x + (index - (count - 1) / 2) * ARROW_SPACING;

/** Radius of the hold ring and of the circle of press pips around the arrow, in art px. */
export const RING_RADIUS = 18;

export interface UiTextSpec {
  readonly label: string;
  /** Where the text's anchor goes, in playfield px. The anchor is the text's centre horizontally. */
  readonly at: Point;
  /** The anchor's height on the text: 0 at its top, 1 at its bottom. */
  readonly anchorY: number;
  /** The original's font size, in art px. */
  readonly size: number;
  /** The smallest font size in CSS px, whatever the square's scale. */
  readonly min: number;
  readonly fill: number;
}

// `ArrowText`: 200×50 at canvas (0, −145), Top, 20 px, grey; its text ended just above the arrows. The port anchors it
// at its bottom, just above the hold ring, so a font clamped up to `min` on a small square grows upward, away from the
// arrows, the ring and the pips.
export const CHALLENGE_PROMPT: UiTextSpec = {
  label: "challenge-prompt",
  at: { x: 250, y: ARROW_ROW.y - RING_RADIUS - 4 },
  anchorY: 1,
  size: 20,
  min: 16,
  fill: VOICE_GREY,
};

// `PressAnyKey`: 110×20 at canvas (0, −150), Top, 16 px, white. It was right-aligned in its rect; the port's wording
// is shorter, so it is centred.
export const TAP_PROMPT: UiTextSpec = {
  label: "tap-prompt",
  at: { x: 250, y: 390 },
  anchorY: 0,
  size: 16,
  min: 16,
  fill: WHITE,
};

// `CopyRight`: 150×20 at canvas (0, −233), Top, 12 px, white.
export const CREDITS_TEXT: UiTextSpec = {
  label: "credits",
  at: { x: 250, y: 473 },
  anchorY: 0,
  size: 12,
  min: 12,
  fill: WHITE,
};

// The start gate (m3-plan, deliverable 2). The original's Load scene showed only "This game contains \nflashing
// lights." centred on the canvas; the port keeps that text and line break, adds a load bar under it and the tap prompt
// where Title shows its own, so the begin tap lands on the same spot.
export const GATE_WARNING: UiTextSpec = {
  label: "gate-warning",
  at: { x: 250, y: 230 },
  anchorY: 0.5,
  size: 20,
  min: 16,
  fill: WHITE,
};
export const GATE_PROMPT: UiTextSpec = { ...TAP_PROMPT, label: "gate-prompt" };

/** The load bar, in playfield px: centred under the warning. */
export const GATE_BAR = { x: 170, y: 290, width: 160, height: 4 } as const;

// "Tap to continue" (m3-plan, deliverable 5): white text centred across, where Title's and the ending's own tap prompt
// shows (hidden under it), so on both its box sits clear of the logo and its waves, which reach down to about y 350,
// and of the credits (y 473), with the font clamped up to 16 CSS px on a phone too (m5-plan decision 13).
export const CONTINUE_PROMPT: UiTextSpec = {
  label: "continue-prompt",
  at: { x: 250, y: 405 },
  anchorY: 0.5,
  size: 16,
  min: 16,
  fill: WHITE,
};
