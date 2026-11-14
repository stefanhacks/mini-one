import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PLAYFIELD_SIZE } from "../../core/layout.ts";
import {
  ARROW_ROW,
  ARROW_SPACING,
  arrowX,
  GATE_PROMPT,
  TAP_PROMPT,
  WORLD_EFFECTS,
  WORLD_ORDER,
  WORLD_SPRITES,
} from "./positions.ts";

describe("arrowX", () => {
  it("centres every row, odd or even (owner decision; the original's even row sat half a step right)", () => {
    const CASES: readonly (readonly [count: number, row: readonly number[]])[] = [
      [1, [ARROW_ROW.x]],
      [3, [200, 250, 300]],
      [4, [175, 225, 275, 325]],
      [7, [100, 150, 200, 250, 300, 350, 400]],
    ];

    for (const [count, expected] of CASES) {
      const row = Array.from({ length: count }, (_, i) => arrowX(i, count));

      assert.deepEqual(row, expected, `${count} arrows`);
      row.slice(1).forEach((x, i) => assert.equal(x - row[i], ARROW_SPACING, `${count} arrows: spacing at ${i}`));
      assert.ok(row.every((x) => x > 0 && x < PLAYFIELD_SIZE), `${count} arrows: inside the playfield`);
    }
  });
});

describe("WORLD_ORDER", () => {
  it("draws the weather in by the original's sortingOrder (m5-particles-spec §5)", () => {
    assert.deepEqual(WORLD_ORDER, [
      "tentacles",
      "pillars",
      "seaB",
      "kraken-tail",
      "boat",
      "seaM",
      "clouds",
      "clouds-2",
      "splash",
      "kraken-body",
      "rain",
      "seaF",
      "bubbles",
      "eye-small",
      "eye-large",
      "broken-boat",
    ]);

    const orders = WORLD_ORDER.map((label) => [...WORLD_SPRITES, ...WORLD_EFFECTS]
      .find((row) => row.label === label)?.sortingOrder ?? NaN);

    assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
  });
});

describe("ui text specs", () => {
  it("puts the gate's prompt where Title shows its own", () => {
    assert.deepEqual({ ...GATE_PROMPT, label: TAP_PROMPT.label }, TAP_PROMPT);
    assert.equal(GATE_PROMPT.label, "gate-prompt");
  });
});
