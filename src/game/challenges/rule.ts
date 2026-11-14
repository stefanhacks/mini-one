// The common shape of the three challenge rules (Sequence, Hold, Many) and the input contract they rely on.
// Pure TypeScript with no Pixi import.
import type { GameClock, TimerScope } from "../../core/clock.ts";
import type { Direction } from "../direction.ts";
import type { Tuning } from "./tuning.ts";

export type ChallengeSpec =
  | { readonly kind: "sequence"; readonly directions: readonly Direction[] }
  | { readonly kind: "hold"; readonly direction: Direction }
  | { readonly kind: "many"; readonly direction: Direction };

export type ChallengeKind = ChallengeSpec["kind"];

export interface SequenceProgress {
  readonly kind: "sequence";
  /** Index of the next expected arrow: arrows before it are done (cursorP), it is current (cursorS). */
  readonly pointer: number;
  readonly length: number;
}

export interface HoldProgress {
  readonly kind: "hold";
  /** True while a hold that started during this challenge is running. */
  readonly held: boolean;
  /** 0 when not held, rising to 1 at completion. */
  readonly fraction: number;
}

export interface ManyProgress {
  readonly kind: "many";
  /** Presses counted in the current window. 0 when no window is open. */
  readonly count: number;
  readonly target: number;
  /** Game time left in the current window, in ms. 0 when no window is open (the next counted press opens one). */
  readonly windowRemainingMs: number;
}

export type ChallengeProgress = SequenceProgress | HoldProgress | ManyProgress;

/** What a rule needs besides its spec. */
export interface RuleContext {
  /** The owning state's scope. A rule's timers all live here, so they pause with the clock and die with the state. */
  readonly scope: TimerScope;
  /**
   * Current game time in ms. Must be `() => clock.now` of the clock that owns `scope` (use `ruleContext`), or the
   * timestamps and progress drift from the timers. Only read for timestamps and view progress.
   */
  readonly now: () => number;
  readonly tuning: Tuning;
  /**
   * Called once when the challenge completes: inside `press` for Sequence and Many, inside a timer callback (so
   * during `clock.tick`) for Hold. Optional; `done` can be polled instead.
   */
  readonly onDone?: () => void;
  /**
   * Called on every wrong key: a Sequence press that isn't the next arrow, or a Hold or Many press of another
   * direction (the arrows shake). Never after `done`. Optional.
   */
  readonly onMiss?: () => void;
}

/**
 * One challenge's rule: a small state machine fed discrete input events and game time.
 *
 * Input contract (what the input router must deliver, and what the rules assume):
 * - Events are delivered in the order they happened, from the state's `update` (after the clock ticked for the frame).
 *   A press is therefore timestamped with the frame that drains it (`now()` at that moment).
 * - `press(dir)`: one new source (key or pointer) went down on `dir`. Sent once per new source, even when `dir` is
 *   already held by another source (dual pads, keyboard + pad). Never sent for key repeat. The router aggregates
 *   sources; the rules never see source ids.
 * - `release(dir)`: `dir` is no longer held by ANY source. Sent only on that held → not held edge.
 * - `cancelAll()`: every source was dropped at once (blur, the page hidden, or an overflowing queue). It means
 *   "nothing is held any more"; equivalent to a release of every held direction. A pointercancel or a lost capture
 *   lets only that pointer go, so it gives `release(dir)` if it was the direction's last holder, never `cancelAll()`.
 * - Sources that were already down before the challenge began are not reported as presses. A rule only knows about
 *   presses it received itself: Hold needs a press after the challenge began, whatever was held before.
 *
 * Robustness the router may rely on:
 * - `press(dir)` twice without a release: Sequence and Many count the second press as a new press; Hold keeps the
 *   running hold (no restart).
 * - `release(dir)` or `cancelAll()` with nothing held: ignored.
 * - Every call after `done` is ignored.
 *
 * Time boundaries: a frame ticks the clock (timers fire) before the state drains input, so an input that arrives at
 * exactly a deadline sees the deadline as already passed. Deadlines are exclusive for input (a Sequence press at
 * exactly 1000 ms after the previous correct press is too late; a Many press at exactly 3000 ms after the window
 * opened starts a new window) and inclusive for holding (a Hold held for exactly 3000 ms completes).
 */
export interface ChallengeRule {
  readonly spec: ChallengeSpec;
  press(dir: Direction): void;
  release(dir: Direction): void;
  cancelAll(): void;
  /**
   * Drops the progress of the attempt under way, as if the challenge had just begun: nothing held, no window open, no
   * step done, no timer pending (the pause's resume, 02). Ignored after `done`.
   */
  reset(): void;
  readonly done: boolean;
  readonly progress: ChallengeProgress;
}

/** The usual RuleContext: `now` reads the clock that owns `scope`. */
export const ruleContext = (
  clock: GameClock,
  scope: TimerScope,
  tuning: Tuning,
  onDone?: () => void,
  onMiss?: () => void,
): RuleContext => ({ scope, now: () => clock.now, tuning, onDone, onMiss });
