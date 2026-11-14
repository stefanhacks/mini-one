// Many ("... be fast ..."): press one arrow `manyPresses` times within `manyWindowMs`. Pure TypeScript, no Pixi.
import type { TimerHandle } from "../../core/clock.ts";
import type { Direction } from "../direction.ts";
import type { ChallengeRule, ManyProgress, RuleContext } from "./rule.ts";

/**
 * Rules (01 and 02, with the quirk fix and owner decision):
 * - The window opens at the first counted press of this challenge (not at spawn, and nothing leaks between
 *   challenges: each rule has its own window).
 * - When it expires the count goes back to 0 and no window is open; the next counted press opens a new one.
 * - Presses of other directions count for nothing (they call `context.onMiss`: the arrows shake), and releases and
 *   `cancelAll` are ignored (presses already counted stay counted).
 * - Key repeat must never reach `press` (the router drops `KeyboardEvent.repeat`).
 */
export class ManyRule implements ChallengeRule {
  readonly spec: { readonly kind: "many"; readonly direction: Direction };
  private readonly context: RuleContext;
  private count = 0;
  private windowEnd: number | undefined;
  private timer: TimerHandle | undefined;
  private finished = false;

  constructor(direction: Direction, context: RuleContext) {
    this.spec = { kind: "many", direction };
    this.context = context;
  }

  get done(): boolean {
    return this.finished;
  }

  get progress(): ManyProgress {
    const target = this.context.tuning.manyPresses;

    if (this.finished) {
      return { kind: "many", count: target, target, windowRemainingMs: 0 };
    }

    const windowRemainingMs = this.windowEnd === undefined ? 0 : Math.max(0, this.windowEnd - this.context.now());

    return { kind: "many", count: this.count, target, windowRemainingMs };
  }

  press(dir: Direction): void {
    if (this.finished) {
      return;
    }

    if (dir !== this.spec.direction) {
      // Another direction counts for nothing, but it is a wrong key: the arrows shake.
      this.context.onMiss?.();
      return;
    }

    const { scope, tuning, now } = this.context;

    if (this.windowEnd === undefined) {
      this.windowEnd = now() + tuning.manyWindowMs;
      this.timer = scope.after(tuning.manyWindowMs, () => {
        this.timer = undefined;
        this.windowEnd = undefined;
        this.count = 0;
      });
    }

    this.count++;

    if (this.count >= tuning.manyPresses) {
      if (this.timer !== undefined) {
        scope.cancel(this.timer);
        this.timer = undefined;
      }

      this.windowEnd = undefined;
      this.finished = true;
      this.context.onDone?.();
    }
  }

  release(_dir: Direction): void {}

  cancelAll(): void {}

  reset(): void {
    if (this.finished) {
      return;
    }

    if (this.timer !== undefined) {
      this.context.scope.cancel(this.timer);
      this.timer = undefined;
    }

    this.windowEnd = undefined;
    this.count = 0;
  }
}
