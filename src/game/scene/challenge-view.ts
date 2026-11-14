// A challenge's arrows and cursors (top layer; arrow-row.ts), its hold ring or press pips and its prompt (ui layer).
// Written by Claude Code.
import { Container, Graphics, type Sprite, type Text } from "pixi.js";
import type { ClipPlayer } from "../../core/anim/player.ts";
import type { Layers } from "../../core/layers.ts";
import type { Layout } from "../../core/layout.ts";
import type { ChallengeProgress, ChallengeSpec } from "../challenges/rule.ts";
import { createArrowPairs, createArrowPulse, createArrowShake } from "./arrow-row.ts";
import type { Textures } from "./art-sprite.ts";
import { CHALLENGE_PROMPTS, cursorKey, directionsOf, progressKey } from "./challenge-model.ts";
import { drawProgressArt } from "./progress-art.ts";
import { CHALLENGE_PROMPT } from "./positions.ts";
import { createUiText, placeUiText } from "./ui-text.ts";

export interface ChallengeView {
  readonly arrows: Container;
  readonly progress: Graphics;
  readonly prompt: Text;
  /** The arrows, cursors and prompt of a challenge, or none. Same spec object again: nothing is rebuilt. */
  readonly setChallenge: (spec: ChallengeSpec | null) => void;
  /** The cursors and the ring or pips. Deduplicated by `progressKey`, so it is cheap every frame. */
  readonly setProgress: (progress: ChallengeProgress | null) => void;
  /** Follows a new layout: the prompt and the progress art. */
  readonly relayout: (layout: Layout) => void;
  /**
   * Reduced motion (game/motion.ts): an arrow's pulse held at full alpha and scale 1 instead, and the wrong-key shake
   * a dim instead, now and from then on.
   */
  readonly setPulseHeld: (held: boolean) => void;
  /** The wrong-key feedback on the shown arrows (arrow-row.ts `createArrowShake`). */
  readonly shake: () => void;
}

/**
 * The cursors' textures and the ring or pips in `progress`, for the progress shown while `active` (a challenge is up).
 * Deduplicated by `progressKey`.
 */
const createProgressDraw = (
  progress: Graphics,
  cursors: readonly Sprite[],
  textures: Textures,
  initial: Layout,
  active: () => boolean,
) => {
  let layout = initial;
  let shownProgress: ChallengeProgress | null = null;
  let shownKey = "";

  const draw = () => {
    progress.clear();

    const current = shownProgress;

    if (!active() || current === null) {
      return;
    }

    // Every cursor in the pool is set, shown or not: a pair shown by a later challenge keeps this texture until its
    // first setProgress.
    for (let i = 0; i < cursors.length; i++) {
      cursors[i].texture = textures[cursorKey(i, current)];
    }

    if (current.kind !== "sequence") {
      drawProgressArt(progress, layout, current);
    }
  };

  return {
    reset: () => {
      shownProgress = null;
      shownKey = "";
      progress.clear();
    },
    set: (next: ChallengeProgress | null) => {
      const key = progressKey(next);

      if (key === shownKey) {
        return;
      }

      shownKey = key;
      shownProgress = next;
      draw();
    },
    relayout: (next: Layout) => {
      layout = next;
      draw();
    },
  };
};

export const createChallengeView = (
  layers: Layers,
  textures: Textures,
  initial: Layout,
  clips: ClipPlayer,
): ChallengeView => {
  // Built hidden, as `setChallenge(null)` leaves them: the first Title must look like every replay's.
  const arrows = new Container({ label: "arrows", visible: false });
  const pairs = createArrowPairs(arrows, textures);
  const pulse = createArrowPulse(clips, pairs);
  const shake = createArrowShake(clips, pairs);

  layers.top.addChild(arrows);

  const progress = new Graphics({ label: "challenge-progress" });

  layers.ui.addChild(progress);

  const prompt = createUiText(layers.ui, CHALLENGE_PROMPT, "", false);

  let challenge: ChallengeSpec | null = null;
  const progressDraw = createProgressDraw(progress, pairs.cursors, textures, initial, () => challenge !== null);

  return {
    arrows,
    progress,
    prompt,
    setChallenge: (spec) => {
      if (spec === challenge) {
        return;
      }

      challenge = spec;
      progressDraw.reset();
      shake.setRow(0);
      pulse.stop();
      arrows.visible = spec !== null;
      prompt.visible = spec !== null;
      prompt.text = spec === null ? "" : CHALLENGE_PROMPTS[spec.kind];
      pairs.showRow(directionsOf(spec));
      shake.setRow(directionsOf(spec).length);

      if (spec !== null && spec.kind !== "sequence") {
        pulse.start(spec.kind);
      }
    },
    setProgress: (next) => progressDraw.set(next),
    relayout: (next) => {
      placeUiText(prompt, CHALLENGE_PROMPT, next);
      progressDraw.relayout(next);
    },
    setPulseHeld: (held) => {
      pulse.setHeld(held);
      shake.setHeld(held);
    },
    shake: () => shake.shake(),
  };
};
