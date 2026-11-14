// A challenge's row of arrows and cursors (challenge-view.ts): a pool of pairs, each arrow with its pulse overlay,
// hidden and reused, never destroyed; and the pulse of a Hold's or a Many's arrow. Written by Claude Code.
import { Sprite, type Container } from "pixi.js";
import { CLIPS } from "../../assets/anims.ts";
import type { Clip } from "../../core/anim/clip.ts";
import type { ClipHandle, ClipPlayer } from "../../core/anim/player.ts";
import { placeOnArtGrid } from "../../core/layers.ts";
import type { Direction } from "../direction.ts";
import type { Textures } from "./art-sprite.ts";
import { ARROW_SPRITES } from "./challenge-model.ts";
import { ARROW_ROW, arrowX, CURSOR_OFFSET } from "./positions.ts";

/**
 * The pulse of a Hold or a Many arrow. Each arrow prefab (Assets/Prefabs/arrow_*.prefab) carries two children, "hold"
 * and "many", drawing the arrow's own sprite over it, their animators disabled; KeyManager enables the "hold" one
 * (`ArrowHold`: fading in from 1.5× down to the arrow) on a Hold arrow and the "many" one (`ArrowMany`: growing to
 * 1.35× as it fades out) on a Many arrow. A disabled child draws an exact copy of the opaque arrow on top of it, which
 * changes nothing (the art's alpha is 0 or 1), so the port keeps one overlay per arrow, shown only while it pulses.
 */
const PULSES = { hold: CLIPS.arrowHold, many: CLIPS.arrowMany } as const;

/**
 * The pool of arrow and cursor pairs in `arrows`, each arrow with its pulse overlay: hidden and reused, never
 * destroyed.
 */
export const createArrowPairs = (arrows: Container, textures: Textures) => {
  const arrowSprites: Sprite[] = [];
  const cursorSprites: Sprite[] = [];
  const pulseSprites: Sprite[] = [];

  /** Grows the pool to `count` pairs, each cursor appended before its arrow, and the arrow's pulse after it. */
  const ensure = (count: number) => {
    while (arrowSprites.length < count) {
      const cursor = new Sprite({ texture: textures.cursorEmpty, anchor: 0.5, label: "cursor" });

      cursorSprites.push(arrows.addChild(cursor));
      arrowSprites.push(arrows.addChild(new Sprite({ texture: textures.arrowUp, anchor: 0.5, label: "arrow" })));
      pulseSprites.push(arrows.addChild(new Sprite({
        texture: textures.arrowUp,
        anchor: 0.5,
        label: "arrow-pulse",
        visible: false,
      })));
    }
  };

  /** Shows pair `index` as arrow `dir` in a row of `count`, the cursor under it. */
  const show = (index: number, dir: Direction, count: number) => {
    const arrow = arrowSprites[index];
    const cursor = cursorSprites[index];
    const x = arrowX(index, count);

    arrow.visible = true;
    cursor.visible = true;
    arrow.texture = textures[ARROW_SPRITES[dir]];
    placeOnArtGrid(arrow, x, ARROW_ROW.y);
    placeOnArtGrid(cursor, x, ARROW_ROW.y + CURSOR_OFFSET);
  };

  // A hidden pair keeps its last texture and place; a later challenge sets them again before showing it.
  const hide = (index: number) => {
    arrowSprites[index].visible = false;
    cursorSprites[index].visible = false;
  };

  return {
    arrows: arrowSprites,
    cursors: cursorSprites,
    pulses: pulseSprites,
    /** Shows a row of `directions`, growing the pool as needed, and hides the pairs past it. */
    showRow: (directions: readonly Direction[]) => {
      ensure(directions.length);

      for (let index = 0; index < arrowSprites.length; index++) {
        const dir = directions[index];

        if (dir === undefined) {
          hide(index);
        } else {
          show(index, dir, directions.length);
        }
      }

      // Cursors and arrows were added in pairs; draw every cursor first, as their sortingOrder (0 under 1).
      for (const cursor of cursorSprites) {
        arrows.setChildIndex(cursor, 0);
      }
    },
  };
};

export type ArrowPairs = ReturnType<typeof createArrowPairs>;

/** The pulse of a Hold's or a Many's arrow 0, on its overlay in `pairs`, played on `clips` or held. */
export const createArrowPulse = (clips: ClipPlayer, pairs: ArrowPairs) => {
  let pulse: ClipHandle | null = null;
  let pulseKind: keyof typeof PULSES | null = null;
  let pulseHeld = false;

  /** Plays the pulse on arrow 0's overlay, from its start, or holds it there at alpha 1 and scale 1. */
  const play = () => {
    const [sprite] = pairs.pulses;

    pulse?.stop();
    pulse = null;

    if (pulseKind === null) {
      return;
    }

    if (pulseHeld) {
      sprite.alpha = 1;
      sprite.scale.set(1);
    } else {
      pulse = clips.play(PULSES[pulseKind], { node: sprite });
    }
  };

  return {
    /** Stops the pulse, if any: its overlay hidden, back at scale 1. */
    stop: () => {
      pulse?.stop();
      pulse = null;
      pulseKind = null;

      for (const sprite of pairs.pulses) {
        sprite.visible = false;
        sprite.scale.set(1);
      }
    },
    /** Pulses arrow 0, the only one of a Hold or a Many, over the arrow and on its texture and place. */
    start: (kind: keyof typeof PULSES) => {
      const [arrow] = pairs.arrows;
      const [sprite] = pairs.pulses;

      sprite.texture = arrow.texture;
      sprite.position.copyFrom(arrow.position);
      sprite.visible = true;
      pulseKind = kind;
      play();
    },
    setHeld: (held: boolean) => {
      pulseHeld = held;
      play();
    },
  };
};

/** A key with flat tangents (the Hermite curve eases in and out of it), as the clips' keys are read. */
const flatKey = (time: number, value: number) => ({ time, value, inSlope: 0, outSlope: 0, tangentMode: 136 });

/**
 * The wrong-key shake (new in this port, owner decision): each arrow swings ±3 art px sideways, dying out over 0.3 s,
 * back to its place. Position values are playfield px from the arrow's own place (player.ts `origin`); y stays.
 */
export const ARROW_SHAKE: Clip = {
  name: "ArrowShake (port)",
  length: 0.3,
  loop: false,
  legacy: false,
  controllers: [],
  curves: [
    {
      path: "",
      attribute: "m_LocalPosition.x",
      component: "Transform",
      keys: [[0, 0], [0.05, 3], [0.1, -3], [0.15, 2], [0.2, -2], [0.25, 1], [0.3, 0]].map(([t, v]) => flatKey(t, v)),
    },
    { path: "", attribute: "m_LocalPosition.y", component: "Transform", keys: [flatKey(0, 0), flatKey(0.3, 0)] },
  ],
  sprites: [],
  events: [],
};

/** The shake under reduced motion: the arrows dim to 35% and come back over 0.3 s, without moving. */
export const ARROW_DIM: Clip = {
  name: "ArrowDim (port)",
  length: 0.3,
  loop: false,
  legacy: false,
  controllers: [],
  curves: [
    {
      path: "",
      attribute: "m_Color.a",
      component: "SpriteRenderer",
      keys: [flatKey(0, 1), flatKey(0.08, 0.35), flatKey(0.3, 1)],
    },
  ],
  sprites: [],
  events: [],
};

/**
 * The wrong-key feedback on every shown arrow of `pairs` (and arrow 0's pulse overlay, which draws over it): the shake,
 * or the dim while `held` (reduced motion, as the pulses are held). Written by Claude Code.
 */
export const createArrowShake = (clips: ClipPlayer, pairs: ArrowPairs) => {
  let playing: ClipHandle[] = [];
  let held = false;
  // The shown row's length, for each arrow's place.
  let count = 0;

  /** Stops a shake or dim where it is, every arrow back at its place and fully opaque. */
  const stop = () => {
    for (const handle of playing) {
      handle.stop();
    }

    playing = [];

    for (let index = 0; index < count; index++) {
      pairs.arrows[index].alpha = 1;
      placeOnArtGrid(pairs.arrows[index], arrowX(index, count), ARROW_ROW.y);
    }

    const [overlay] = pairs.pulses;

    if (overlay !== undefined && count > 0) {
      placeOnArtGrid(overlay, arrowX(0, count), ARROW_ROW.y);
    }
  };

  return {
    /** A new row of `length` arrows is shown (or none, 0): any shake stops. */
    setRow: (length: number) => {
      stop();
      count = length;
    },
    shake: () => {
      stop();

      for (let index = 0; index < count; index++) {
        const origin = { x: arrowX(index, count), y: ARROW_ROW.y };
        const nodes = [pairs.arrows[index]];
        const overlay = pairs.pulses[index];

        if (index === 0 && overlay?.visible === true) {
          nodes.push(overlay);
        }

        for (const node of nodes) {
          playing.push(held ? clips.play(ARROW_DIM, { node }) : clips.play(ARROW_SHAKE, { node, origin }));
        }
      }
    },
    setHeld: (next: boolean) => {
      held = next;
    },
  };
};
