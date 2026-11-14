// What the game states drive, as interfaces: the scene, the pad and the input queue. Pure TypeScript with no Pixi
// import, so the whole game flow runs under `node --test` with fakes. main.ts passes the real scene (scene.ts), the pad
// view (pad-view.ts) and the input router (input/dom-router.ts), which all satisfy these.
import type { WorldSfxKey } from "../../core/audio/audio-engine.ts";
import type { GameClock } from "../../core/clock.ts";
import type { State } from "../../core/state-machine.ts";
import type { Rng } from "../challenges/rng.ts";
import type { ChallengeProgress, ChallengeSpec } from "../challenges/rule.ts";
import type { EndlessTuning, Tuning } from "../challenges/tuning.ts";
import type { Direction } from "../direction.ts";
import type { InputEvent } from "../input/pointer-map.ts";
import type { StrikeKind } from "../lightning.ts";
import type { StoryPage } from "../story/cursor.ts";
import type { Measure } from "../story/paging.ts";
import type { CueName } from "./timings.ts";

export type GameStateId = "gate" | "title" | "story" | "transition" | "round" | "endless" | "ending";

export type GameState = State<GameStateId>;

/** The input router's side the states use. */
export interface InputSource {
  /** The queued events, oldest first; empties the queue. */
  drain(): InputEvent[];
  /** Drops queued events and makes whatever is down stale. Call it on every enter and phase change. */
  beginEpoch(): void;
}

/** The pad view's side the states use. */
export interface PadControl {
  setVisible(visible: boolean): void;
  setDimmed(dimmed: boolean): void;
  setHint(dir: Direction | null): void;
}

/** How story text wraps right now. A new object after every layout change, so a state can tell it changed. */
export interface Paging {
  readonly linesPerPage: number;
  readonly measure: Measure;
}

export type Backdrop = "pillars" | "tentacles";

/**
 * - `whole`: the boat, bobbing (`Barco`).
 * - `broken`: the broken boat at its Main.unity spot.
 * - `thrown`: the broken boat thrown up (`BarcoQuebradoJogadoCima`), then kept at its end pose.
 * - `none`: neither.
 */
export type Boat = "whole" | "broken" | "thrown" | "none";

/**
 * What lives under the sea from now on (scene/particles): story part `part`'s bubbles (1 a second for part 0, then 2,
 * 4 and 6 after each won round, as GameManager.SetBubbles meant; m5-plan, owner decision 10), and the window an eye
 * may show in, in place of the bubbles.
 */
export interface Undersea {
  readonly part: number;
  /**
   * How long from now (game ms) an eye may show: a window with no text box or challenge up (part 0's preamble, the
   * wait after a won round, a transition, the ending before the kraken; m5-plan, owner decision 11). 0 for none: on
   * Title, behind a page and during a round's challenges.
   */
  readonly eyesFor: number;
}

/**
 * How a show or hide plays: the original's fade clip for that object (`FadeIn`/`FadeOut`, `TMPFadeIn`/`TMPFadeOut`,
 * `FadeKrakenA`/`B`), at `speed` clip seconds per game second. Without one, it is a cut.
 */
export interface Fade {
  readonly speed: number;
}

/**
 * The scene as the states see it: show and hide per scene state. Each call is a cut unless it takes a `fade`; the
 * fades run in the scene on the game clock. A shown object is visible at once (a fade-in starts at alpha 0); a hidden
 * one ends invisible at alpha 0 (after its fade-out). Every call is idempotent: asking for what an object shows, or
 * is fading to, changes nothing. A new call cuts a fade still running on the same object. The ambient loops (sea,
 * clouds, the whole boat's bob) run from the scene's build on, through every replay.
 */
export interface SceneView {
  /**
   * Back to the opening frame, as cuts: sea, sky, the whole boat and the vignette; everything else hidden, every fade
   * and pulse stopped, the moved sprites back at their places.
   */
  reset(): void;
  /** The logo and the credits (`FadeIn`/`FadeOut`, `TMPFadeIn`/`TMPFadeOut`). Hiding them drops a pending reveal. */
  setTitle(visible: boolean, fade?: Fade): void;
  /** The credits alone (`TMPFadeIn`/`TMPFadeOut`): Title fades them in at the end of its intro. */
  setCredits(visible: boolean, fade?: Fade): void;
  /**
   * A lightning strike (`DoTheThunder`): the bolt and the flash, drawn from `rng` (the game's lightning stream). A
   * `title-reveal` also shows the logo at the flash's peak (TITLE_REVEAL_FLASH_MS later). A strike cuts the one before.
   */
  strike(kind: StrikeKind, rng: Rng): void;
  /**
   * The tap prompt under the logo ("Tap to begin", "Tap to play again"), or none. Shown, it pulses (`TMPIdle`), after
   * its fade-in (`TMPFadeIn`) if it has one; hidden with a fade, it fades out (`TMPFadeOut`). A new text on a shown
   * prompt only changes the text.
   */
  setPrompt(text: string | null, fade?: Fade): void;
  /**
   * The text box with a story page, or neither. Only the page's first `revealed` characters show (all by default):
   * the typewriter. The page is laid out whole, so typing never moves what already shows. Calling it again with the
   * same page object and a new count is cheap (the story state does every frame while typing).
   */
  setStoryPage(page: StoryPage | null, revealed?: number): void;
  /**
   * The arrows, cursors and prompt of a challenge, or none. A Hold or Many arrow pulses (`ArrowHold`, `ArrowMany`).
   * Same spec object again: nothing is rebuilt.
   */
  setChallenge(spec: ChallengeSpec | null): void;
  /** The cursors and the hold ring / press pips for the shown challenge. Cheap to call every frame. */
  setProgress(progress: ChallengeProgress | null): void;
  /**
   * Endless mode's time bar under the arrows: the share of the time left (0..1), or null for none. Cheap to call every
   * frame. `reset` hides it.
   */
  setTimeLeft(fraction: number | null): void;
  /**
   * The wrong-key feedback: every shown arrow shakes a little, or dims for a moment under reduced motion. A new call
   * restarts it; a new challenge (or none) stops it.
   */
  shakeArrows(): void;
  /** A backdrop (`FadeIn`/`FadeOut`). */
  setBackdrop(backdrop: Backdrop, visible: boolean, fade?: Fade): void;
  setBoat(boat: Boat): void;
  /** The kraken's body and tail. Shown with a fade they fade in (`FadeKrakenA`/`B`), the body rising; hiding cuts. */
  setKraken(visible: boolean, fade?: Fade): void;
  /** The black overlay (the original's `TelaPreta`, `FadeIn`/`FadeOut`) over the world, under the text box. */
  setBlack(visible: boolean, fade?: Fade): void;
  /**
   * Restarts the rain, its splashes, the bubbles and the eyes for a new game (Title, on every enter, after `reset`):
   * their draws come from `seed`'s own streams, and they are prewarmed, as Unity's systems were at load.
   */
  startWeather(seed: number): void;
  /**
   * The bubbles and the eyes from now on. `reset` sets Title's: part 0's bubbles, no eye. `null` from the ending's
   * kraken on: the bubbles stop and fade with any eye (m5-plan, owner decision 4).
   */
  setUndersea(undersea: Undersea | null): void;
  readonly paging: Paging;
}

/**
 * The endless-mode icon as the states see it (endless-plan.md): main.ts turns its hit area and the E key on with it
 * (the router's endless input) and shows the icon.
 */
export interface EndlessIcon {
  /** Offered or not; `highlighted` pulses it (the Ending's replay prompt). Idempotent. */
  setAvailable(available: boolean, highlighted: boolean): void;
}

/** What the start gate loads (app/game-loader.ts: sprites, font and audio, then the scene is built). */
export interface GateLoader {
  /**
   * Loads everything not loaded yet and builds the scene, reporting progress (0..1). Resolves once the scene exists;
   * rejects if anything failed, after reporting the error itself (Gate doesn't). Calling it again retries only what
   * failed. Gate never calls it twice at once.
   */
  load(onProgress: (fraction: number) => void): Promise<void>;
  /** Whether the UI font is in. The gate's texts wait for it (or a failure), so they never flash in a fallback font. */
  readonly fontReady: boolean;
}

/** The audio engine's side the gate uses (src/core/audio/audio-engine.ts satisfies it). */
export interface GateAudio {
  /** Resumes the context. Only works synchronously inside a user gesture's DOM handler. Idempotent. */
  unlock(): void;
  /** Starts BGM01 with its fade-in. Once per engine; later calls do nothing. */
  startMusic(): void;
}

/**
 * The audio engine's side the game states use (src/core/audio/audio-engine.ts satisfies it): the gate's unlock and
 * music, the cues' sounds and the music per story part.
 */
export interface GameAudio extends GateAudio {
  /** A world SFX at a random pitch, cutting the previous one (the original's single SFX channel). */
  playSfx(key: WorldSfxKey): void;
  /** The music overlay of a story part (0..3), from the next bar; null for none. */
  setStoryPart(part: number | null): void;
}

/** A cue as it fired: which, in which state, and when in that state's timeline (ms of game time since its enter). */
export interface CueEvent {
  readonly name: CueName;
  readonly state: GameStateId;
  readonly at: number;
}

/** What the gate screen shows. */
export interface GateScreen {
  /** The load bar's fill (0..1), or null for no bar. */
  readonly progress: number | null;
  /** The flashing-lights warning. */
  readonly warning: boolean;
  /** The line under the warning ("Tap to begin", "Couldn't load. Tap to retry"), or none. */
  readonly prompt: string | null;
}

/**
 * The start gate's own view. Separate from SceneView because it shows before the textures and the font the scene is
 * built from have loaded. Static: nothing animates. Idempotent.
 */
export interface GateView {
  /** Shows the gate screen, or hides it (null). */
  show(screen: GateScreen | null): void;
}

export interface GameDeps {
  /** Loads the assets and builds the scene; driven by Gate. */
  readonly loader: GateLoader;
  readonly gateView: GateView;
  readonly audio: GameAudio;
  /**
   * Called on every cue, right after its sound and (for a strike) `SceneView.strike`, inside the clock tick that
   * reached it. app/cue-log.ts logs it for `window.debug`.
   */
  readonly onCue: (event: CueEvent) => void;
  readonly clock: GameClock;
  readonly input: InputSource;
  readonly pad: PadControl;
  /** The scene. Only called once `loader.load()` resolved (every state after Gate). */
  readonly scene: () => SceneView;
  /** The seed of each new game: `?seed=` based in tests and bug reports, random otherwise. */
  readonly nextSeed: () => number;
  readonly tuning: Tuning;
  /** Endless mode's difficulty curve (endless-plan.md). */
  readonly endless: EndlessTuning;
  readonly endlessIcon: EndlessIcon;
  /**
   * Called on every new game (Title's enter, and the Ending's way into endless mode), before it starts: the app's
   * housekeeping (app/text-cache.ts).
   */
  readonly onTitle?: () => void;
}
