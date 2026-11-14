import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GameClock } from "../../core/clock.ts";
import type { Direction } from "../direction.ts";
import type { RuleContext } from "./rule.ts";
import { SequenceRule } from "./sequence.ts";
import { TUNING } from "./tuning.ts";

const setup = (directions: Direction[]) => {
  const clock = new GameClock();
  const scope = clock.createScope();
  const doneAt: number[] = [];
  let misses = 0;
  const context: RuleContext = {
    scope,
    now: () => clock.now,
    tuning: TUNING,
    onDone: () => doneAt.push(clock.now),
    onMiss: () => {
      misses += 1;
    },
  };
  const rule = new SequenceRule(directions, context);
  const pointer = () => rule.progress.pointer;

  return { clock, scope, rule, doneAt, pointer, misses: () => misses };
};

describe("SequenceRule", () => {
  it("advances on each correct press and completes on the last, calling onDone once", () => {
    const { clock, rule, doneAt, pointer } = setup(["up", "down", "left"]);

    assert.deepEqual(rule.progress, { kind: "sequence", pointer: 0, length: 3 });
    rule.press("up");
    clock.tick(100);
    rule.press("down");
    assert.equal(pointer(), 2);
    assert.equal(rule.done, false);
    clock.tick(100);
    rule.press("left");

    assert.equal(rule.done, true);
    assert.equal(pointer(), 3);
    assert.deepEqual(doneAt, [200]);
  });

  it("resets to 0 on a wrong press", () => {
    const { rule, pointer } = setup(["up", "down", "left"]);

    rule.press("up");
    rule.press("down");
    rule.press("right");
    assert.equal(pointer(), 0);
  });

  it("starts over on a wrong press equal to step 0: step 0 is needed again (owner decision)", () => {
    // The owner's example: "right down up right", entered "right down right".
    const { rule, pointer, misses } = setup(["right", "down", "up", "right"]);

    rule.press("right");
    rule.press("down");
    rule.press("right");
    assert.equal(pointer(), 0);
    assert.equal(misses(), 1);
    rule.press("down");
    assert.equal(pointer(), 0, "down isn't step 0");
    rule.press("right");
    rule.press("down");
    rule.press("up");
    rule.press("right");
    assert.equal(rule.done, true);
    assert.equal(misses(), 2);
  });

  it("handles repeated step-0 arrows: a third up on up, up, down starts over", () => {
    const { rule, pointer } = setup(["up", "up", "down"]);

    rule.press("up");
    rule.press("up");
    rule.press("up");
    assert.equal(pointer(), 0);
    rule.press("up");
    rule.press("up");
    rule.press("down");
    assert.equal(rule.done, true);
  });

  it("calls onMiss on every wrong press, and never on a correct one", () => {
    const { rule, misses } = setup(["up", "down"]);

    rule.press("left");
    rule.press("up");
    rule.press("left");
    rule.press("up");
    rule.press("down");
    rule.press("left");
    assert.equal(misses(), 2, "the press after done is ignored");
  });

  it("resets after 1 s without a correct press, without any input", () => {
    const { clock, rule, pointer } = setup(["up", "down", "left"]);

    rule.press("up");
    clock.tick(999);
    assert.equal(pointer(), 1);
    clock.tick(1);
    assert.equal(pointer(), 0);
  });

  it("restarts the timeout on each correct press", () => {
    const { clock, rule, pointer } = setup(["up", "down", "left"]);

    rule.press("up");
    clock.tick(999);
    rule.press("down");
    clock.tick(999);
    assert.equal(pointer(), 2);
    rule.press("left");
    assert.equal(rule.done, true);
  });

  it("treats a press at exactly the timeout as late: the timer fires in the tick, before input is drained", () => {
    const { clock, rule, pointer } = setup(["up", "down", "left"]);

    rule.press("up");
    clock.tick(1000);
    rule.press("down");
    assert.equal(pointer(), 0);

    rule.press("up");
    clock.tick(1000);
    // Late, but equal to step 0, so it starts over at step 1.
    rule.press("up");
    assert.equal(pointer(), 1);
  });

  it("cancels the timeout on a wrong press equal to step 0, as on any wrong press", () => {
    const { clock, rule, pointer } = setup(["up", "down", "left"]);

    rule.press("up");
    clock.tick(600);
    rule.press("up");
    assert.equal(pointer(), 0);
    assert.equal(clock.pendingTimers, 0);
  });

  it("does not restart the timeout on a truly wrong press: the pointer is 0 and stays 0", () => {
    const { clock, rule, pointer } = setup(["up", "down", "left"]);

    rule.press("up");
    clock.tick(600);
    rule.press("right");
    assert.equal(pointer(), 0);
    clock.tick(5000);
    assert.equal(pointer(), 0);
  });

  it("starts a fresh timeout from the next correct press after a wrong one", () => {
    const { clock, rule, pointer } = setup(["up", "down", "left"]);

    rule.press("up");
    clock.tick(900);
    rule.press("right");
    assert.equal(pointer(), 0);
    clock.tick(50);
    rule.press("up");
    clock.tick(999);
    assert.equal(pointer(), 1);
    clock.tick(1);
    assert.equal(pointer(), 0);
  });

  it("has no timeout before the first correct press", () => {
    const { clock, rule, pointer } = setup(["up", "down"]);

    clock.tick(5000);
    rule.press("up");
    rule.press("down");
    assert.equal(rule.done, true);
    assert.equal(pointer(), 2);
  });

  it("handles same-frame presses in event order, so mashing every arrow doesn't advance", () => {
    const { rule, pointer } = setup(["left", "left", "left"]);

    for (const dir of ["down", "left", "right", "up"] as const) {
      rule.press(dir);
    }

    assert.equal(pointer(), 0);

    for (let i = 0; i < 3; i++) {
      for (const dir of ["down", "left", "right", "up"] as const) {
        rule.press(dir);
      }
    }

    assert.equal(rule.done, false);
  });

  it("counts a second press of an already-held direction as a new press (dual pads)", () => {
    const { rule } = setup(["up", "up"]);

    rule.press("up");
    rule.press("up");
    assert.equal(rule.done, true);
  });

  it("ignores releases and cancelAll", () => {
    const { rule, pointer } = setup(["up", "down"]);

    rule.press("up");
    rule.release("up");
    rule.release("left");
    rule.cancelAll();
    assert.equal(pointer(), 1);
  });

  it("ignores everything after completion, and its timeout no longer fires", () => {
    const { clock, rule, doneAt, pointer } = setup(["up"]);

    rule.press("up");
    rule.press("down");
    rule.press("up");
    clock.tick(5000);

    assert.equal(pointer(), 1);
    assert.equal(rule.done, true);
    assert.deepEqual(doneAt, [0]);
  });

  it("freezes the timeout while the clock is paused", () => {
    const { clock, rule, pointer } = setup(["up", "down"]);

    rule.press("up");
    clock.tick(500);
    clock.paused = true;
    clock.tick(5000);
    clock.paused = false;
    clock.tick(499);
    assert.equal(pointer(), 1);
    clock.tick(1);
    assert.equal(pointer(), 0);
  });

  it("stops quietly when its scope is disposed (the state exited)", () => {
    const { clock, scope, rule, pointer } = setup(["up", "down"]);

    rule.press("up");
    scope.dispose();
    clock.tick(5000);
    assert.equal(pointer(), 1);
    rule.press("down");
    assert.equal(rule.done, true);
  });

  it("copies its directions and rejects an empty sequence", () => {
    const directions: Direction[] = ["up", "down"];
    const { rule } = setup(directions);

    directions[0] = "left";
    assert.deepEqual(rule.spec, { kind: "sequence", directions: ["up", "down"] });
    assert.throws(() => setup([]), RangeError);
  });
});
