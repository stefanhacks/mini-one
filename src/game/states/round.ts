import type { TimerScope } from "../../core/clock.ts";
import type { StateMachine } from "../../core/state-machine.ts";
import { Round } from "../challenges/round.ts";
import { ruleContext } from "../challenges/rule.ts";
import { applyChallengeInput } from "./common.ts";
import type { GameSession } from "./session.ts";
import { AFTER_ROUND_MS, FADE } from "./timings.ts";
import type { Backdrop, GameDeps, GameState, GameStateId } from "./types.ts";

/** The backdrop each round reveals when won: pillars after the first, tentacles after the second. */
const BACKDROPS: readonly (Backdrop | null)[] = ["pillars", "tentacles", null];

/**
 * Round `session.part`: its challenges one after another (challenges/round.ts), on this state's clock and scope.
 *
 * Every update drains the input queue and feeds the round through `applyChallengeInput`: press, release and cancel go
 * to the challenge, the taps are dropped. Once the last challenge is done the arrows
 * go, the pad dims, the round's backdrop starts its 1 s fade-in on the win (the original triggers its `FadeIn` there)
 * and AFTER_ROUND_MS later the next story part starts. Events after that are dropped.
 */
export const createRound = (deps: GameDeps, session: GameSession): GameState => {
  const { clock, input, pad, scene, tuning } = deps;

  const showChallenge = () => {
    const spec = session.round?.current?.spec ?? null;
    const view = scene();

    view.setChallenge(spec);
    view.setProgress(session.round?.current?.progress ?? null);
    // Only the single-arrow challenges get the hint: on a Sequence it would give the order away.
    pad.setHint(spec !== null && spec.kind !== "sequence" ? spec.direction : null);
  };

  /** The last challenge is done: the arrows go, the pad dims, the backdrop fades in, and the next part follows. */
  const winRound = (scope: TimerScope, machine: StateMachine<GameStateId>) => {
    const backdrop = BACKDROPS[session.part] ?? null;
    const view = scene();

    session.phase = "won";
    input.beginEpoch();
    pad.setDimmed(true);
    pad.setHint(null);
    view.setChallenge(null);

    if (backdrop !== null) {
      view.setBackdrop(backdrop, true, FADE);
    }

    // An eye may show until the next part's text box (m5-plan, owner decision 11).
    view.setUndersea({ part: session.part, eyesFor: AFTER_ROUND_MS });

    scope.after(AFTER_ROUND_MS, () => {
      session.part += 1;
      machine.request("story");
    });
  };

  return {
    enter: (scope, machine) => {
      input.beginEpoch();

      const specs = session.rounds[session.part];

      if (specs === undefined) {
        throw new Error(`No round ${session.part} in this game`);
      }

      pad.setVisible(true);
      pad.setDimmed(false);
      session.phase = "play";
      // No eye while the challenges are up.
      scene().setUndersea({ part: session.part, eyesFor: 0 });

      const context = ruleContext(clock, scope, tuning, () => winRound(scope, machine), () => scene().shakeArrows());

      session.round = new Round(specs, context, showChallenge);
      showChallenge();
    },
    update: () => {
      const round = session.round;

      for (const event of input.drain()) {
        if (round === null || round.done) {
          break;
        }

        applyChallengeInput(round, event);
      }

      scene().setProgress(round?.current?.progress ?? null);
    },
    exit: () => {
      scene().setChallenge(null);
      pad.setHint(null);
      session.round = null;
    },
  };
};
