import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { endlessLevel, endlessStoryPart, generateEndless, timeLimitMs } from "./endless.ts";
import { createRng } from "./rng.ts";
import type { ChallengeSpec } from "./rule.ts";
import { ENDLESS_TUNING, TUNING } from "./tuning.ts";

const sequence = (length: number): ChallengeSpec => ({ kind: "sequence", directions: Array(length).fill("up") });

describe("endlessLevel", () => {
  it("grows by step, and caps at 9 arrows, 4 directions and a 40% share", () => {
    const table = [0, 2, 3, 6, 12, 18, 100].map((level) => [level, endlessLevel(level, ENDLESS_TUNING)] as const);

    assert.deepEqual(table.map(([level, { length, directions }]) => [level, length, directions]), [
      [0, 3, 2], [2, 3, 2], [3, 4, 3], [6, 5, 4], [12, 7, 4], [18, 9, 4], [100, 9, 4],
    ]);
    assert.deepEqual(table.map(([, { specialShare }]) => Math.round(specialShare * 100)), [0, 0, 10, 20, 40, 40, 40]);
  });
});

describe("generateEndless", () => {
  it("replays the same challenges from the same seed", () => {
    const run = (seed: number) => {
      const rng = createRng(seed);

      return Array.from({ length: 30 }, (_, level) => generateEndless(rng, level, ENDLESS_TUNING));
    };

    assert.deepEqual(run(7), run(7));
    assert.notDeepEqual(run(7), run(8));
  });

  it("gives only Sequences of the level's length, from at most its directions, below level 3", () => {
    for (let seed = 0; seed < 50; seed++) {
      const rng = createRng(seed);

      for (let level = 0; level < 3; level++) {
        const spec = generateEndless(rng, level, ENDLESS_TUNING);

        assert.equal(spec.kind, "sequence");
        assert.ok(spec.kind === "sequence" && spec.directions.length === 3);
        assert.ok(spec.kind === "sequence" && new Set(spec.directions).size <= 2);
      }
    }
  });

  it("mixes in Holds and Manys at about the level's share", () => {
    const rng = createRng(1);
    const specs = Array.from({ length: 2000 }, () => generateEndless(rng, 50, ENDLESS_TUNING));
    const share = (kind: string) => specs.filter((spec) => spec.kind === kind).length / specs.length;

    assert.ok(Math.abs(share("hold") - 0.2) < 0.03, `hold ${share("hold")}`);
    assert.ok(Math.abs(share("many") - 0.2) < 0.03, `many ${share("many")}`);
  });
});

describe("timeLimitMs", () => {
  it("gives a Sequence 1 s plus 900 ms an arrow at level 0, shrinking to 350 ms an arrow", () => {
    assert.equal(timeLimitMs(sequence(3), 0, TUNING, ENDLESS_TUNING), 3700);
    assert.equal(timeLimitMs(sequence(4), 3, TUNING, ENDLESS_TUNING), Math.round(1000 + 4 * 900 * 0.94 ** 3));
    assert.equal(timeLimitMs(sequence(9), 40, TUNING, ENDLESS_TUNING), 4150);
  });

  it("gives a Hold or a Many its own 3 s plus a slack of 2 s, shrinking to 600 ms", () => {
    assert.equal(timeLimitMs({ kind: "hold", direction: "up" }, 0, TUNING, ENDLESS_TUNING), 5000);
    assert.equal(timeLimitMs({ kind: "many", direction: "up" }, 0, TUNING, ENDLESS_TUNING), 5000);
    assert.equal(timeLimitMs({ kind: "hold", direction: "up" }, 40, TUNING, ENDLESS_TUNING), 3600);
  });

  it("never grows from one level to the next for the same challenge", () => {
    for (let level = 0; level < 60; level++) {
      assert.ok(timeLimitMs(sequence(5), level + 1, TUNING, ENDLESS_TUNING)
        <= timeLimitMs(sequence(5), level, TUNING, ENDLESS_TUNING));
    }
  });
});

describe("timeLimitMs, Holds", () => {
  it("never lets the hold take more than 85% of the limit, at any level, whatever the slack", () => {
    const hold: ChallengeSpec = { kind: "hold", direction: "up" };

    for (let level = 0; level < 100; level++) {
      assert.ok(TUNING.holdMs / timeLimitMs(hold, level, TUNING, ENDLESS_TUNING) <= 0.85, `level ${level}`);
    }

    // With no slack at all, the floor alone keeps it there.
    const noSlack = { ...ENDLESS_TUNING, slackMs: 0, minSlackMs: 0 };

    assert.equal(timeLimitMs(hold, 0, TUNING, noSlack), Math.ceil(TUNING.holdMs / 0.85));
  });
});

describe("endlessStoryPart", () => {
  it("steps up to parts 1, 2 and 3 at levels 5, 10 and 15", () => {
    assert.deepEqual([0, 4, 5, 9, 10, 15, 99].map((level) => endlessStoryPart(level, ENDLESS_TUNING)), [
      0, 0, 1, 1, 2, 3, 3,
    ]);
  });
});
