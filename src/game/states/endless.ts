// Endless mode (endless-plan.md): one timed challenge after another until one times out, then the kraken. Pure
// TypeScript with no Pixi import. Written by Claude Code.
import type { TimerScope } from "../../core/clock.ts";
import type { StateMachine } from "../../core/state-machine.ts";
import { endlessStoryPart, generateEndless, timeLimitMs } from "../challenges/endless.ts";
import { createRng, type Rng } from "../challenges/rng.ts";
import { ruleContext } from "../challenges/rule.ts";
import { TimedChallenge } from "../challenges/timed.ts";
import { createStoryCursor } from "../story/cursor.ts";
import { ENDLESS_LINES, type StoryLine } from "../story/script.ts";
import { createTypewriter } from "../story/typewriter.ts";
import { applyChallengeInput, hidePad } from "./common.ts";
import type { GameSession } from "./session.ts";
import { CAUGHT_EAT_MS, CAUGHT_HOLD_MS, FADE, STORY_DEBOUNCE_MS, WHISPER_MS_PER_CHAR } from "./timings.ts";
import type { Backdrop, GameDeps, GameState, GameStateId } from "./types.ts";

/** Mixed into the game's seed for endless mode's challenges, so they draw from their own stream. */
export const ENDLESS_SALT = 0xe0d1e55;

/** The backdrop each story part reveals as the level reaches it, as the story's won rounds do: none at part 3. */
const BACKDROPS: readonly (Backdrop | null)[] = [null, "pillars", "tentacles", null];

/**
 * Endless mode, entered on a new game whose `session.mode` is "endless" (from Title's exit, or the Ending's). Phases:
 * - `intro`: "... follow ..." is typed in the voice's style. A tap completes it, and once typed, a tap after
 *   STORY_DEBOUNCE_MS goes on, as a story page.
 * - `play`: the pad is up with a challenge generated for `session.level` (challenges/endless.ts), under its time limit
 *   (challenges/timed.ts). Input goes to it as in Round.
 * - `cleared`: the challenge was done in time. The level rises, the story part steps up when the level reaches the
 *   next one (music overlay, bubbles, backdrop; owner decision 6), and `betweenMs` later the next challenge shows.
 * - `caught`: the limit passed. Input is dropped, the challenge and the pad go, black fades in, "... eat ..." is typed
 *   over it from CAUGHT_EAT_MS, and CAUGHT_HOLD_MS after it is typed the Ending runs (its endless variant).
 *
 * The single whispers always fit one page (they are 14 characters), so unlike Story there is no repaging on a layout
 * change: the text box wraps the page itself.
 */
export const createEndless = (deps: GameDeps, session: GameSession): GameState => {
  const { audio, clock, input, pad, scene, tuning, endless } = deps;
  let rng: Rng = createRng(0);
  // When the shown whisper was typed out (game time), or null while it types.
  let typedAt: number | null = null;

  /** Shows `lines`' only page in the text box and starts typing it. */
  const showWhisper = (lines: readonly StoryLine[]) => {
    const { linesPerPage, measure } = scene().paging;

    session.cursor = createStoryCursor(lines, linesPerPage, measure);
    session.typewriter = createTypewriter(session.cursor.page?.text.length ?? 0, WHISPER_MS_PER_CHAR);
    typedAt = null;
    scene().setStoryPage(session.cursor.page, session.typewriter.revealed);
  };

  const hideWhisper = () => {
    typedAt = null;
    scene().setStoryPage(null);
    session.cursor = null;
    session.typewriter = null;
  };

  /** Types the shown whisper on, or completes it on `complete`. Notes when it is done. */
  const typeWhisper = (deltaMS: number, complete: boolean) => {
    const { cursor, typewriter } = session;

    if (cursor === null || typewriter === null) {
      return;
    }

    if (!typewriter.done) {
      if (complete) {
        typewriter.complete();
      } else {
        typewriter.update(deltaMS);
      }

      scene().setStoryPage(cursor.page, typewriter.revealed);
    }

    if (typewriter.done && typedAt === null) {
      typedAt = clock.now;
    }
  };

  /** The story part the level reaches: its music overlay, bubbles and backdrop, each once. */
  const stepStory = () => {
    const part = endlessStoryPart(session.level, endless);

    if (part <= session.part) {
      return;
    }

    session.part = part;
    audio.setStoryPart(part);

    const backdrop = BACKDROPS[part] ?? null;

    if (backdrop !== null) {
      scene().setBackdrop(backdrop, true, FADE);
    }
  };

  const showChallenge = () => {
    const spec = session.timed?.spec ?? null;
    const view = scene();

    view.setChallenge(spec);
    view.setProgress(session.timed?.progress ?? null);
    // Only the single-arrow challenges get the hint, as in Round.
    pad.setHint(spec !== null && spec.kind !== "sequence" ? spec.direction : null);
  };

  /** Hides the challenge and its hint, the pad dimmed (`cleared`) or gone (`caught`). */
  const clearChallenge = () => {
    scene().setChallenge(null);
    scene().setTimeLeft(null);
    pad.setHint(null);
    session.timed = null;
  };

  const caught = (scope: TimerScope) => {
    session.phase = "caught";
    input.beginEpoch();
    clearChallenge();
    hidePad(pad);
    scene().setBlack(true, FADE);
    scope.after(CAUGHT_EAT_MS, () => showWhisper(ENDLESS_LINES.eat));
  };

  const play = (scope: TimerScope, machine: StateMachine<GameStateId>) => {
    session.phase = "play";
    input.beginEpoch();
    pad.setDimmed(false);
    // No eye while a challenge is up.
    scene().setUndersea({ part: session.part, eyesFor: 0 });

    const spec = generateEndless(rng, session.level, endless);
    const context = ruleContext(clock, scope, tuning, () => cleared(scope, machine), () => scene().shakeArrows());

    const limitMs = timeLimitMs(spec, session.level, tuning, endless);

    session.timed = new TimedChallenge(spec, context, limitMs, () => caught(scope));
    showChallenge();
    scene().setTimeLeft(1);
  };

  const cleared = (scope: TimerScope, machine: StateMachine<GameStateId>) => {
    session.phase = "cleared";
    session.level += 1;
    input.beginEpoch();
    pad.setDimmed(true);
    clearChallenge();
    stepStory();
    // An eye may show until the next challenge (m5-plan, owner decision 11).
    scene().setUndersea({ part: session.part, eyesFor: endless.betweenMs });
    scope.after(endless.betweenMs, () => play(scope, machine));
  };

  return {
    enter: () => {
      input.beginEpoch();
      hidePad(pad);
      rng = createRng((session.seed ^ ENDLESS_SALT) >>> 0);
      session.timed = null;
      session.phase = "intro";
      audio.setStoryPart(session.part);
      // No eye behind the text box.
      scene().setUndersea({ part: session.part, eyesFor: 0 });
      showWhisper(ENDLESS_LINES.intro);
    },
    update: (deltaMS, machine, scope) => {
      const events = input.drain();

      switch (session.phase) {
      case "intro": {
        const advanced = events.some((event) => event.kind === "advance");
        const wasTyping = session.typewriter?.done === false;

        typeWhisper(deltaMS, advanced);

        if (!wasTyping && advanced && typedAt !== null && clock.now - typedAt >= STORY_DEBOUNCE_MS) {
          hideWhisper();
          pad.setVisible(true);
          play(scope, machine);
        }

        break;
      }
      case "play": {
        for (const event of events) {
          // A timeout or a completion inside this loop changes the phase: the rest is dropped.
          if (session.phase !== "play" || session.timed === null) {
            break;
          }

          applyChallengeInput(session.timed, event);
        }

        const timed = session.timed;

        scene().setProgress(timed?.progress ?? null);
        scene().setTimeLeft(timed === null ? null : timed.remainingMs / timed.limitMs);
        break;
      }
      case "caught":
        typeWhisper(deltaMS, false);

        if (typedAt !== null && clock.now - typedAt >= CAUGHT_HOLD_MS) {
          hideWhisper();
          machine.request("ending");
        }

        break;
      default:
        break;
      }
    },
    exit: () => {
      scene().setChallenge(null);
      scene().setTimeLeft(null);
      pad.setHint(null);
      session.timed = null;
      session.cursor = null;
      session.typewriter = null;
    },
  };
};
