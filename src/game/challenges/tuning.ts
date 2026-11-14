// Every challenge tunable in one place, so device playtests change them here. Pure TypeScript.
// Values from 01-original-game.md and KeyManager.cs (sequenceDelay is 2 in code, overridden to 1 in Main.unity).

export interface RoundTuning {
  /** Challenges in the round. */
  readonly challenges: number;
  /** Arrows in each Sequence challenge. */
  readonly length: number;
  /** Hold challenges, at random distinct indices. */
  readonly holds: number;
  /** Many challenges, at random distinct indices (distinct from the Holds too). */
  readonly manys: number;
}

export interface Tuning {
  /** Sequence: a correct press must follow the previous one within this time, or the pointer resets to 0. */
  readonly sequenceTimeoutMs: number;
  /** Hold: how long the direction must stay held. */
  readonly holdMs: number;
  /** Many: presses needed within one window. */
  readonly manyPresses: number;
  /** Many: the window, from its first counted press. */
  readonly manyWindowMs: number;
  readonly rounds: readonly RoundTuning[];
}

export const TUNING: Tuning = {
  sequenceTimeoutMs: 1000,
  holdMs: 3000,
  manyPresses: 10,
  manyWindowMs: 3000,
  rounds: [
    { challenges: 3, length: 3, holds: 1, manys: 0 },
    { challenges: 5, length: 5, holds: 0, manys: 1 },
    { challenges: 7, length: 7, holds: 1, manys: 1 },
  ],
};

/**
 * Endless mode (endless-plan.md): how the challenges grow and the time limits shrink with the level (challenges cleared
 * in the run). Starting values for playtests. Written by Claude Code.
 */
export interface EndlessTuning {
  /** Arrows in a Sequence at level 0. */
  readonly startLength: number;
  /** Most arrows in a Sequence: what the arrow row fits (9 × ARROW_SPACING on the 500 px playfield). */
  readonly maxLength: number;
  /** Levels per step: a step adds an arrow and `specialShareStep` of Holds and Manys. */
  readonly levelsPerStep: number;
  /** Directions a Sequence draws from at level 0. */
  readonly startDirections: number;
  /** The levels at which a Sequence draws from one more direction (up to all 4). */
  readonly directionLevels: readonly number[];
  /** The share of Holds and Manys added per step. */
  readonly specialShareStep: number;
  readonly maxSpecialShare: number;
  /** A Sequence's limit: this plus its length × the per-arrow time. */
  readonly sequenceBaseMs: number;
  /** The per-arrow time at level 0, multiplied by `decay` per level, down to `minPerArrowMs`. */
  readonly perArrowMs: number;
  readonly minPerArrowMs: number;
  /** A Hold's or Many's limit: its own time (`holdMs`, `manyWindowMs`) plus this slack, decaying to `minSlackMs`. */
  readonly slackMs: number;
  readonly minSlackMs: number;
  /** The most of a Hold's limit its hold may take (owner decision): the limit is at least `holdMs / maxHoldShare`. */
  readonly maxHoldShare: number;
  /** Per level, on the per-arrow time and the slack. */
  readonly decay: number;
  /** The pause between a cleared challenge and the next, the pad dimmed. */
  readonly betweenMs: number;
  /** The levels at which the music overlay, the bubbles and the backdrops step up to story parts 1, 2 and 3. */
  readonly storyLevels: readonly number[];
}

export const ENDLESS_TUNING: EndlessTuning = {
  startLength: 3,
  maxLength: 9,
  levelsPerStep: 3,
  startDirections: 2,
  directionLevels: [3, 6],
  specialShareStep: 0.1,
  maxSpecialShare: 0.4,
  sequenceBaseMs: 1000,
  perArrowMs: 900,
  minPerArrowMs: 350,
  slackMs: 2000,
  minSlackMs: 600,
  maxHoldShare: 0.85,
  decay: 0.94,
  betweenMs: 300,
  storyLevels: [5, 10, 15],
};
