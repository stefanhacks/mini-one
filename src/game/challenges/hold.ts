// Hold ("... hold strong ..."): hold one arrow for `holdMs`. Pure TypeScript with no Pixi import.
import type { TimerHandle } from "../../core/clock.ts";
import type { Direction } from "../direction.ts";
import type { ChallengeRule, HoldProgress, RuleContext } from "./rule.ts";

/**
 * Rules (01 and 02):
 * - A press of the direction starts the hold; it completes once held for `holdMs` of game time (a timer, so it
 *   completes without any further input).
 * - Its release, or `cancelAll`, resets it. Other directions don't affect it, pressed or released; a press of one calls
 *   `context.onMiss` (the arrows shake).
 * - Only a press received by this rule starts a hold: a direction already held when the challenge began does not
 *   count until it is pressed again. A second press while holding keeps the running hold.
 */
export class HoldRule implements ChallengeRule {
  readonly spec: { readonly kind: "hold"; readonly direction: Direction };
  private readonly context: RuleContext;
  private startedAt: number | undefined;
  private timer: TimerHandle | undefined;
  private finished = false;

  constructor(direction: Direction, context: RuleContext) {
    this.spec = { kind: "hold", direction };
    this.context = context;
  }

  get done(): boolean {
    return this.finished;
  }

  get progress(): HoldProgress {
    if (this.finished) {
      return { kind: "hold", held: false, fraction: 1 };
    }

    if (this.startedAt === undefined) {
      return { kind: "hold", held: false, fraction: 0 };
    }

    const fraction = (this.context.now() - this.startedAt) / this.context.tuning.holdMs;

    return { kind: "hold", held: true, fraction: Math.min(1, Math.max(0, fraction)) };
  }

  press(dir: Direction): void {
    if (this.finished) {
      return;
    }

    if (dir !== this.spec.direction) {
      // A wrong key: the arrows shake. A running hold of the right direction goes on.
      this.context.onMiss?.();
      return;
    }

    if (this.startedAt !== undefined) {
      return;
    }

    this.startedAt = this.context.now();
    this.timer = this.context.scope.after(this.context.tuning.holdMs, () => {
      this.timer = undefined;
      this.startedAt = undefined;
      this.finished = true;
      this.context.onDone?.();
    });
  }

  release(dir: Direction): void {
    if (dir === this.spec.direction) {
      this.reset();
    }
  }

  cancelAll(): void {
    this.reset();
  }

  reset(): void {
    if (this.finished || this.startedAt === undefined) {
      return;
    }

    if (this.timer !== undefined) {
      this.context.scope.cancel(this.timer);
      this.timer = undefined;
    }

    this.startedAt = undefined;
  }
}
