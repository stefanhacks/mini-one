import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GameClock } from "../../core/clock.ts";
import { ManyRule } from "./many.ts";
import type { RuleContext } from "./rule.ts";
import { TUNING } from "./tuning.ts";

const setup = () => {
  const clock = new GameClock();
  const scope = clock.createScope();
  const doneAt: number[] = [];
  const context: RuleContext = { scope, now: () => clock.now, tuning: TUNING, onDone: () => doneAt.push(clock.now) };
  const rule = new ManyRule("left", context);

  return { clock, scope, context, rule, doneAt };
};

// Presses `count` times, `gap` ms apart, the first one now.
const tap = (clock: GameClock, rule: ManyRule, count: number, gap: number) => {
  for (let i = 0; i < count; i++) {
    if (i > 0) {
      clock.tick(gap);
    }

    rule.press("left");
  }
};

describe("ManyRule", () => {
  it("completes on the 10th press within 3 s and calls onDone once", () => {
    const { clock, rule, doneAt } = setup();

    tap(clock, rule, 9, 300);
    assert.equal(rule.progress.count, 9);
    assert.equal(rule.done, false);
    clock.tick(299);
    rule.press("left");

    assert.equal(rule.done, true);
    assert.deepEqual(doneAt, [2699]);
    assert.deepEqual(rule.progress, { kind: "many", count: 10, target: 10, windowRemainingMs: 0 });
  });

  it("opens the window at the first correct press, not at spawn (02 fix)", () => {
    const { clock, rule } = setup();

    clock.tick(5000);
    assert.deepEqual(rule.progress, { kind: "many", count: 0, target: 10, windowRemainingMs: 0 });
    rule.press("left");
    assert.equal(rule.progress.windowRemainingMs, 3000);
    tap(clock, rule, 9, 333);
    assert.equal(rule.done, true);
  });

  it("counts a press at 2999 ms, and resets the count at exactly 3000 ms", () => {
    const { clock, rule } = setup();

    rule.press("left");
    clock.tick(2999);
    rule.press("left");
    assert.equal(rule.progress.count, 2);
    clock.tick(1);
    assert.deepEqual(rule.progress, { kind: "many", count: 0, target: 10, windowRemainingMs: 0 });
  });

  it("starts the next window at the press that arrives at exactly the expiry (timer fires first)", () => {
    const { clock, rule } = setup();

    tap(clock, rule, 9, 100);
    clock.tick(3000 - 800);
    rule.press("left");
    assert.equal(rule.progress.count, 1);
    assert.equal(rule.progress.windowRemainingMs, 3000);
  });

  it("starts the next window at the next counted press after expiry, not at the expiry (owner decision)", () => {
    const { clock, rule } = setup();

    tap(clock, rule, 5, 100);
    clock.tick(4000);
    assert.equal(rule.progress.count, 0);
    rule.press("left");
    assert.deepEqual(rule.progress, { kind: "many", count: 1, target: 10, windowRemainingMs: 3000 });
    tap(clock, rule, 9, 330);
    assert.equal(rule.done, true);
  });

  it("ignores other directions: they neither count nor open a window", () => {
    const { clock, rule } = setup();

    for (let i = 0; i < 20; i++) {
      rule.press("right");
      rule.press("up");
      rule.press("down");
    }

    assert.deepEqual(rule.progress, { kind: "many", count: 0, target: 10, windowRemainingMs: 0 });
    tap(clock, rule, 10, 10);
    assert.equal(rule.done, true);
  });

  it("counts a press of an already-held direction (dual pads), and ignores releases and cancelAll", () => {
    const { rule } = setup();

    for (let i = 0; i < 9; i++) {
      rule.press("left");
      rule.release("left");
      rule.cancelAll();
    }

    assert.equal(rule.progress.count, 9);
    rule.press("left");
    assert.equal(rule.done, true);
  });

  it("gives each challenge its own window: nothing leaks from the previous one (02 fix)", () => {
    const { clock, context, rule } = setup();

    tap(clock, rule, 10, 250);
    assert.equal(rule.done, true);
    clock.tick(2000);

    const next = new ManyRule("left", context);
    assert.equal(next.progress.windowRemainingMs, 0);
    clock.tick(2000);
    next.press("left");
    assert.equal(next.progress.windowRemainingMs, 3000);
  });

  it("ignores everything after completion; its window timer is gone", () => {
    const { clock, rule, doneAt } = setup();

    tap(clock, rule, 10, 0);
    rule.press("left");
    clock.tick(10000);
    assert.deepEqual(doneAt, [0]);
    assert.deepEqual(rule.progress, { kind: "many", count: 10, target: 10, windowRemainingMs: 0 });
  });

  it("freezes the window while the clock is paused", () => {
    const { clock, rule } = setup();

    rule.press("left");
    clock.tick(1000);
    clock.paused = true;
    clock.tick(10000);
    assert.equal(rule.progress.windowRemainingMs, 2000);
    clock.paused = false;
    tap(clock, rule, 9, 200);
    assert.equal(rule.done, true);
  });

  it("calls onMiss on a press of another direction", () => {
    const clock = new GameClock();
    let misses = 0;
    const rule = new ManyRule("up", {
      scope: clock.createScope(),
      now: () => clock.now,
      tuning: TUNING,
      onMiss: () => {
        misses += 1;
      },
    });

    rule.press("up");
    rule.press("left");
    assert.equal(misses, 1);
    assert.equal(rule.progress.count, 1, "it counts for nothing");
  });
});
