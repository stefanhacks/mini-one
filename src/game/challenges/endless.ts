// Endless mode's challenges (endless-plan.md): the difficulty at a level, one challenge at a time drawn from the
// run's RNG, its time limit, and the story part its level reaches. Pure TypeScript with no Pixi import. Written by
// Claude Code.
import { DIRECTIONS, type Direction } from "../direction.ts";
import type { Rng } from "./rng.ts";
import type { ChallengeSpec } from "./rule.ts";
import type { EndlessTuning, Tuning } from "./tuning.ts";

/** What a level asks for. */
export interface EndlessLevel {
  /** Arrows in a Sequence. */
  readonly length: number;
  /** How many directions a Sequence draws from (2 to 4). */
  readonly directions: number;
  /** The chance a challenge is a Hold or a Many instead of a Sequence (half each). */
  readonly specialShare: number;
}

const countReached = (levels: readonly number[], level: number) => levels.filter((at) => at <= level).length;

/** The difficulty at `level` (challenges cleared in the run, from 0). */
export const endlessLevel = (level: number, endless: EndlessTuning): EndlessLevel => {
  const steps = Math.floor(level / endless.levelsPerStep);

  return {
    length: Math.min(endless.maxLength, endless.startLength + steps),
    directions: Math.min(DIRECTIONS.length, endless.startDirections + countReached(endless.directionLevels, level)),
    specialShare: Math.min(endless.maxSpecialShare, steps * endless.specialShareStep),
  };
};

/** `count` distinct directions, in random order (a partial Fisher–Yates over DIRECTIONS). */
const pickDirections = (rng: Rng, count: number): Direction[] => {
  const pool = [...DIRECTIONS];

  for (let i = 0; i < count; i++) {
    const j = i + rng.nextInt(pool.length - i);

    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  return pool.slice(0, count);
};

/**
 * The challenge at `level`. Draw order, part of a seed's replay: the kind (`next`, then Hold or Many with
 * `nextInt(2)`), then a Hold's or Many's direction over all 4, or a Sequence's directions in play, then its arrows
 * uniform over them.
 */
export const generateEndless = (rng: Rng, level: number, endless: EndlessTuning): ChallengeSpec => {
  const { length, directions, specialShare } = endlessLevel(level, endless);

  if (rng.next() < specialShare) {
    const kind = rng.nextInt(2) === 0 ? "hold" : "many";

    return { kind, direction: DIRECTIONS[rng.nextInt(DIRECTIONS.length)] ?? DIRECTIONS[0] };
  }

  const pool = pickDirections(rng, directions);

  return { kind: "sequence", directions: Array.from({ length }, () => pool[rng.nextInt(pool.length)] ?? pool[0]) };
};

/**
 * `spec`'s time limit at `level`, in ms of game time: a Sequence gets a base plus a per-arrow time, a Hold or a Many
 * its own time plus a slack. The per-arrow time and the slack shrink by `decay` per level, down to their floors. A
 * Hold's limit is also at least `holdMs / maxHoldShare`, so the hold is at most that share of it.
 */
export const timeLimitMs = (spec: ChallengeSpec, level: number, tuning: Tuning, endless: EndlessTuning): number => {
  const shrink = endless.decay ** level;

  if (spec.kind === "sequence") {
    const perArrow = Math.max(endless.minPerArrowMs, endless.perArrowMs * shrink);

    return Math.round(endless.sequenceBaseMs + spec.directions.length * perArrow);
  }

  const slack = Math.max(endless.minSlackMs, endless.slackMs * shrink);

  if (spec.kind === "many") {
    return Math.round(tuning.manyWindowMs + slack);
  }

  // The hold never takes more than `maxHoldShare` of the limit (owner decision).
  return Math.ceil(Math.max(tuning.holdMs + slack, tuning.holdMs / endless.maxHoldShare));
};

/** The story part (0–3) whose music, bubbles and backdrops show at `level`. */
export const endlessStoryPart = (level: number, endless: EndlessTuning) => countReached(endless.storyLevels, level);
