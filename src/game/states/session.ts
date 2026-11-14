// The state of one game, shared by the states, and a plain-data snapshot of it for `window.debug`. Pure TypeScript.
import { generateRounds, type RoundSpec } from "../challenges/generate.ts";
import { createRng, type Rng } from "../challenges/rng.ts";
import type { Round } from "../challenges/round.ts";
import type { ChallengeProgress, ChallengeSpec } from "../challenges/rule.ts";
import type { TimedChallenge } from "../challenges/timed.ts";
import type { Tuning } from "../challenges/tuning.ts";
import { LIGHTNING_SALT } from "../lightning.ts";
import type { StoryCursor } from "../story/cursor.ts";
import type { Typewriter } from "../story/typewriter.ts";

/**
 * The current state's phase ("" before the first game): what e2e and the unit tests wait on. Title's are `title` (the
 * intro), `prompt` (taps count) and `leaving` (the exit fade).
 */
export type SessionPhase =
  | ""
  | "title"
  | "prompt"
  | "leaving"
  | "preamble"
  | "page"
  | "transition"
  | "play"
  | "won"
  | EndlessPhase
  | EndingPhase;

/**
 * Endless mode's phases (states/endless.ts): `intro` (the opening whisper; a tap goes on), `play` (a timed challenge
 * up), `cleared` (the pause before the next) and `caught` (the timeout: black, then "... eat ...").
 */
export type EndlessPhase = "intro" | "cleared" | "caught";

/** The Ending's phases, in order (ending.ts). `replay` takes the tap, as Title's `prompt` does. */
export type EndingPhase = "boat" | "thrown" | "kraken" | "black" | "sea" | "card" | "replay";
// The Ending also uses Title's `leaving`: the card fading out before endless mode.

/** The story, or endless mode (endless-plan.md). */
export type GameMode = "story" | "endless";

export interface GameSession {
  /** Which mode this game plays. Every new game starts as the story; endless mode switches it. */
  mode: GameMode;
  /** Endless mode's level: challenges cleared in the run. 0 in the story, and on every new game. */
  level: number;
  /** The current game's seed. */
  seed: number;
  /** Games started, this one included: 1 for the first, 2 after one replay. */
  games: number;
  /** Every round's challenges, generated from `seed` when the game starts. */
  rounds: readonly RoundSpec[];
  /** The strikes' draws (bolt, x, mirror), from `seed ^ LIGHTNING_SALT`: a stream apart from the rounds'. */
  lightning: Rng;
  /** The story part being read, or the round being played after it: 0–3 (rounds 0–2). */
  part: number;
  /** The current state's phase, for tests. */
  phase: SessionPhase;
  /** The running round, while in Round. */
  round: Round | null;
  /** The timed challenge up, while endless mode plays. */
  timed: TimedChallenge | null;
  /** The story cursor, while in Story. */
  cursor: StoryCursor | null;
  /** The typing of the shown story page, while in Story. */
  typewriter: Typewriter | null;
}

export const createSession = (): GameSession => ({
  mode: "story",
  level: 0,
  seed: 0,
  games: 0,
  rounds: [],
  lightning: createRng(LIGHTNING_SALT),
  part: 0,
  phase: "",
  round: null,
  timed: null,
  cursor: null,
  typewriter: null,
});

/**
 * Starts a new game on `session` (Title, on every enter): its seed, the game count, every round generated from the
 * seed and the lightning stream, from story part 0 with no round or story running, in story mode at level 0 (so the
 * difficulty resets on Title). The phase is the caller's.
 */
export const startNewGame = (session: GameSession, seed: number, tuning: Tuning) => {
  session.mode = "story";
  session.level = 0;
  session.seed = seed;
  session.games += 1;
  session.rounds = generateRounds(createRng(seed), tuning);
  session.lightning = createRng((seed ^ LIGHTNING_SALT) >>> 0);
  session.part = 0;
  session.round = null;
  session.timed = null;
  session.cursor = null;
  session.typewriter = null;
};

export interface SessionSnapshot {
  readonly mode: GameMode;
  readonly level: number;
  readonly seed: number;
  readonly games: number;
  readonly part: number;
  readonly phase: SessionPhase;
  /**
   * The current challenge's index in the round, its spec and progress, while a round runs. In endless mode, while a
   * timed challenge is up: its index is the level, and `count` is 0 (a run has no end).
   */
  readonly challenge: {
    readonly index: number;
    readonly count: number;
    readonly spec: ChallengeSpec;
    readonly progress: ChallengeProgress;
  } | null;
  /** The time limit of endless mode's challenge and what is left of it, in ms of game time, while one is up. */
  readonly timer: { readonly limitMs: number; readonly remainingMs: number } | null;
  /** The story page shown, while reading. */
  readonly page: {
    readonly line: number;
    readonly page: number;
    readonly text: string;
    readonly whisper: boolean;
    /** How many of the page's characters show (the typewriter). */
    readonly revealed: number;
    /** Whether the page is typed out (or was completed by a tap). */
    readonly typed: boolean;
  } | null;
}

/** Plain data, safe to hand to `page.evaluate` in e2e. */
export const snapshotSession = (session: GameSession): SessionSnapshot => {
  const rule = session.round?.current;
  const { timed } = session;
  const page = session.cursor?.page ?? null;
  const typewriter = session.typewriter;
  const roundChallenge = session.round && rule
    ? { index: session.round.index, count: session.round.specs.length, spec: rule.spec, progress: rule.progress }
    : null;
  const timedChallenge = timed === null || timed.done || timed.timedOut
    ? null
    : { index: session.level, count: 0, spec: timed.spec, progress: timed.progress };

  return {
    mode: session.mode,
    level: session.level,
    seed: session.seed,
    games: session.games,
    part: session.part,
    phase: session.phase,
    challenge: roundChallenge ?? timedChallenge,
    timer: timed === null ? null : { limitMs: timed.limitMs, remainingMs: timed.remainingMs },
    page: session.cursor && page
      ? {
        line: session.cursor.lineIndex,
        page: session.cursor.pageIndex,
        text: page.text,
        whisper: page.whisper,
        revealed: typewriter?.revealed ?? page.text.length,
        typed: typewriter?.done ?? true,
      }
      : null,
  };
};
