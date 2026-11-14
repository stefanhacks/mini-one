// Sequence ("... follow ..."): press the shown arrows in order. Pure TypeScript with no Pixi import.
import type { TimerHandle } from "../../core/clock.ts";
import type { Direction } from "../direction.ts";
import type { ChallengeRule, RuleContext, SequenceProgress } from "./rule.ts";

/**
 * Rules (01 and 02, with the quirk fixes and owner decisions):
 * - A correct press advances the pointer and (re)starts the timeout: `sequenceTimeoutMs` after the last correct
 *   press, the pointer resets to 0.
 * - Any wrong press resets the pointer to 0, even one equal to step 0: the attempt starts over and needs step 0 pressed
 *   again (owner decision, replacing 02's "a wrong step-0 press counts as step 0"). It doesn't restart the timeout (as
 *   the original's `delayTimer`): with the pointer at 0 the timeout has nothing left to reset, so it is cancelled. It
 *   calls `context.onMiss` (the arrows shake).
 * - Every press is a discrete event handled in order, so mashing several arrows in one frame no longer advances.
 * - Releases are ignored.
 */
export class SequenceRule implements ChallengeRule {
  readonly spec: { readonly kind: "sequence"; readonly directions: readonly Direction[] };
  private readonly context: RuleContext;
  private pointer = 0;
  private timeout: TimerHandle | undefined;
  private finished = false;

  constructor(directions: readonly Direction[], context: RuleContext) {
    if (directions.length === 0) {
      throw new RangeError("A Sequence needs at least one direction");
    }

    this.spec = { kind: "sequence", directions: [...directions] };
    this.context = context;
  }

  get done(): boolean {
    return this.finished;
  }

  get progress(): SequenceProgress {
    return { kind: "sequence", pointer: this.pointer, length: this.spec.directions.length };
  }

  press(dir: Direction): void {
    if (this.finished) {
      return;
    }

    const { directions } = this.spec;

    if (dir === directions[this.pointer]) {
      this.pointer++;
      this.restartTimeout();

      if (this.pointer === directions.length) {
        this.finish();
      }

      return;
    }

    this.pointer = 0;
    this.stopTimeout();
    this.context.onMiss?.();
  }

  release(_dir: Direction): void {}

  cancelAll(): void {}

  reset(): void {
    if (!this.finished) {
      this.pointer = 0;
      this.stopTimeout();
    }
  }

  private restartTimeout(): void {
    this.stopTimeout();
    this.timeout = this.context.scope.after(this.context.tuning.sequenceTimeoutMs, () => {
      this.timeout = undefined;
      this.pointer = 0;
    });
  }

  private stopTimeout(): void {
    if (this.timeout !== undefined) {
      this.context.scope.cancel(this.timeout);
      this.timeout = undefined;
    }
  }

  private finish(): void {
    this.stopTimeout();
    this.finished = true;
    this.context.onDone?.();
  }
}
