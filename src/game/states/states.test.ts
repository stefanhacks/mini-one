import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GameClock } from "../../core/clock.ts";
import { StateMachine } from "../../core/state-machine.ts";
import type { ChallengeProgress, ChallengeSpec } from "../challenges/rule.ts";
import { ENDLESS_TUNING, TUNING } from "../challenges/tuning.ts";
import type { Direction } from "../direction.ts";
import { createFrameStepper } from "../frame-step.ts";
import type { WorldSfxKey } from "../../core/audio/audio-engine.ts";
import type { InputEvent } from "../input/pointer-map.ts";
import type { StoryPage } from "../story/cursor.ts";
import { fixedWidthMeasure } from "../story/fake-measure.ts";
import { ENDLESS_LINES, STORY_PARTS } from "../story/script.ts";
import { TAP_TO_PLAY_AGAIN } from "./ending.ts";
import { createGame, type GameDeps, type GameStateId } from "./index.ts";
import { snapshotSession } from "./session.ts";
import {
  AFTER_ROUND_MS,
  CAUGHT_EAT_MS,
  CAUGHT_HOLD_MS,
  ENDING_CARD_SPEED,
  ENDLESS_TITLE_MS,
  ENDING_MS,
  STORY_DEBOUNCE_MS,
  STORY_PREAMBLE_MS,
  TITLE_AMBIENT,
  TITLE_CUES,
  TITLE_EXIT_MS,
  TITLE_PROMPT_MS,
  TYPE_MS_PER_CHAR,
  WHISPER_MS_PER_CHAR,
  TRANSITION_MS,
} from "./timings.ts";
import { AMBIENT_SALT, TAP_TO_BEGIN } from "./title.ts";
import { ambientDelay } from "./cues.ts";
import { createRng, type Rng } from "../challenges/rng.ts";
import { drawStrike, LIGHTNING_SALT, type Strike, type StrikeKind } from "../lightning.ts";
import { LOAD_FAILED } from "./gate.ts";
import type { Backdrop, Boat, CueEvent, Fade, GateScreen, Paging, SceneView, Undersea } from "./types.ts";

const FRAME_MS = 16;

// Lets every pending promise callback run: setImmediate fires after the microtask queue drains.
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

// A load promise the test settles by hand.
const deferred = () => {
  let resolve = () => {};
  let reject = (_error: Error) => {};
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });

  return { promise, resolve, reject };
};

/** A scene call that shows or hides something, with its game time and fade speed (0 for a cut). */
interface SceneCall {
  readonly at: number;
  readonly call: string;
  readonly speed: number;
}

class FakeScene implements SceneView {
  /** The calls that show or hide something (not the cuts of `reset`), in order. */
  calls: SceneCall[] = [];
  readonly clock: GameClock;
  logo = false;
  credits = false;
  /** Every strike, drawn as the real scene draws it. */
  strikes: Strike[] = [];
  prompt: string | null = null;
  page: StoryPage | null = null;
  /** The characters of `page` shown: Infinity for all. */
  revealed = Infinity;
  challenge: ChallengeSpec | null = null;
  progress: ChallengeProgress | null = null;
  timeLeft: number | null = null;
  /** How many times the arrows were shaken (a wrong key). */
  shakes = 0;
  backdrops = new Set<Backdrop>();
  boat: Boat = "whole";
  kraken = false;
  black = false;
  /**
   * Every `startWeather` seed, and every undersea set, `reset`'s included, as "part" and its eye window in ms, or
   * "none".
   */
  weathers: number[] = [];
  undersea: string[] = [];
  paging: Paging = { linesPerPage: 2, measure: fixedWidthMeasure(30) };

  constructor(clock: GameClock) {
    this.clock = clock;
  }

  private note(call: string, fade?: Fade) {
    this.calls.push({ at: this.clock.now, call, speed: fade?.speed ?? 0 });
  }

  /** The calls from `from` (game ms) on, as "call@ms from `from`" with their speed when faded. */
  callsSince(from: number) {
    return this.calls
      .filter((call) => call.at >= from)
      .map(({ at, call, speed }) => `${call}@${at - from}${speed === 0 ? "" : ` ×${speed}`}`);
  }

  reset() {
    this.logo = false;
    this.credits = false;
    this.prompt = null;
    this.page = null;
    this.revealed = Infinity;
    this.challenge = null;
    this.progress = null;
    this.timeLeft = null;
    this.backdrops.clear();
    this.boat = "whole";
    this.kraken = false;
    this.black = false;
    this.setUndersea({ part: 0, eyesFor: 0 });
  }

  /** Logo and credits both. */
  get title() {
    return this.logo && this.credits;
  }

  setTitle(visible: boolean, fade?: Fade) {
    this.note(`title ${visible}`, fade);
    this.logo = visible;
    this.credits = visible;
  }

  setCredits(visible: boolean, fade?: Fade) {
    this.note(`credits ${visible}`, fade);
    this.credits = visible;
  }

  // The real scene shows the logo at the flash's peak, 250 ms later; the fake shows it at once.
  strike(kind: StrikeKind, rng: Rng) {
    this.strikes.push(drawStrike(kind, rng));

    if (kind === "title-reveal") {
      this.logo = true;
    }
  }

  setPrompt(text: string | null, fade?: Fade) {
    this.note(`prompt ${text}`, fade);
    this.prompt = text;
  }

  setStoryPage(page: StoryPage | null, revealed = Infinity) {
    this.page = page;
    this.revealed = revealed;
  }

  setChallenge(spec: ChallengeSpec | null) {
    this.challenge = spec;
  }

  setProgress(progress: ChallengeProgress | null) {
    this.progress = progress;
  }

  setTimeLeft(fraction: number | null) {
    this.timeLeft = fraction;
  }

  shakeArrows() {
    this.shakes += 1;
  }

  setBackdrop(backdrop: Backdrop, visible: boolean, fade?: Fade) {
    this.note(`${backdrop} ${visible}`, fade);

    if (visible) {
      this.backdrops.add(backdrop);
    } else {
      this.backdrops.delete(backdrop);
    }
  }

  setBoat(boat: Boat) {
    this.note(`boat ${boat}`);
    this.boat = boat;
  }

  setKraken(visible: boolean, fade?: Fade) {
    this.note(`kraken ${visible}`, fade);
    this.kraken = visible;
  }

  setBlack(visible: boolean, fade?: Fade) {
    this.note(`black ${visible}`, fade);
    this.black = visible;
  }

  startWeather(seed: number) {
    this.weathers.push(seed);
  }

  setUndersea(undersea: Undersea | null) {
    this.undersea.push(undersea === null ? "none" : `${undersea.part} ${undersea.eyesFor}`);
  }
}

// The gate's loader: every `load` call gets its own deferred, settled by the test (or at once with `auto`).
class FakeLoader {
  calls: ReturnType<typeof deferred>[] = [];
  progress: ((fraction: number) => void)[] = [];
  fontReady = true;
  auto: boolean;

  constructor(auto: boolean) {
    this.auto = auto;
  }

  load(onProgress: (fraction: number) => void) {
    const call = deferred();

    this.calls.push(call);
    this.progress.push(onProgress);

    if (this.auto) {
      onProgress(1);
      call.resolve();
    }

    return call.promise;
  }

  get last() {
    const call = this.calls.at(-1);

    if (call === undefined) {
      throw new Error("load was never called");
    }

    return call;
  }
}

class FakeGateView {
  screen: GateScreen | null = null;

  show(screen: GateScreen | null) {
    this.screen = screen;
  }
}

class FakeAudio {
  log: string[] = [];
  sfx: string[] = [];
  parts: (number | null)[] = [];

  unlock() {
    this.log.push("unlock");
  }

  startMusic() {
    this.log.push("startMusic");
  }

  playSfx(key: WorldSfxKey) {
    this.sfx.push(key);
  }

  setStoryPart(part: number | null) {
    this.parts.push(part);
  }
}

class FakeInput {
  queue: InputEvent[] = [];
  epochs = 0;

  drain() {
    const events = this.queue;

    this.queue = [];

    return events;
  }

  beginEpoch() {
    this.epochs += 1;
    this.queue = [];
  }

  advance() {
    this.queue.push({ kind: "advance" });
  }

  press(dir: Direction) {
    this.queue.push({ kind: "press", dir });
  }

  release(dir: Direction) {
    this.queue.push({ kind: "release", dir });
  }

  endless() {
    this.queue.push({ kind: "endless" });
  }
}

class FakeEndlessIcon {
  available = false;
  highlighted = false;

  setAvailable(available: boolean, highlighted: boolean) {
    this.available = available;
    this.highlighted = highlighted;
  }
}

class FakePad {
  visible = false;
  dimmed = false;
  hint: Direction | null = null;

  setVisible(visible: boolean) {
    this.visible = visible;
  }

  setDimmed(dimmed: boolean) {
    this.dimmed = dimmed;
  }

  setHint(dir: Direction | null) {
    this.hint = dir;
  }
}

const timerCount = (clock: GameClock) => clock.pendingTimers;

const setup = ({ auto = true } = {}) => {
  const clock = new GameClock();
  const loader = new FakeLoader(auto);
  const gateView = new FakeGateView();
  const audio = new FakeAudio();
  const scene = new FakeScene(clock);
  const input = new FakeInput();
  const pad = new FakePad();
  const endlessIcon = new FakeEndlessIcon();
  let seed = 41;
  // Every cue with the clock's time, as main.ts logs them.
  const cues: (CueEvent & { time: number })[] = [];
  const deps: GameDeps = {
    loader,
    gateView,
    audio,
    onCue: (event) => cues.push({ ...event, time: clock.now }),
    clock,
    input,
    pad,
    scene: () => scene,
    nextSeed: () => ++seed,
    tuning: TUNING,
    endless: ENDLESS_TUNING,
    endlessIcon,
  };
  const game = createGame(deps);
  const machine = new StateMachine<GameStateId>(clock, game.states);

  machine.request("gate");

  const frame = (ms = FRAME_MS) => machine.update(ms);
  const wait = (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += FRAME_MS) {
      frame();
    }
  };

  return { clock, scene, input, pad, game, machine, frame, wait, loader, gateView, audio, cues, endlessIcon };
};

type Setup = ReturnType<typeof setup>;

/** Loads, then taps to begin as the router would: the activation inside the gesture, then the advance. */
const toTitle = async (t: Setup) => {
  await settle();
  t.frame();
  assert.equal(t.game.gate.phase, "ready");
  t.game.gate.activate();
  t.input.advance();
  t.frame();
  assert.equal(t.machine.current, "title");
};

/** From the start of Title: waits for the prompt, taps, and waits out the exit fade into story part 0. */
const leaveTitle = (t: Setup) => {
  t.wait(TITLE_PROMPT_MS);
  assert.equal(t.game.session.phase, "prompt");
  t.input.advance();
  t.frame();
  assert.equal(t.game.session.phase, "leaving");
  t.wait(TITLE_EXIT_MS);
  assert.equal(t.machine.current, "story");
};

/**
 * Reads the current story part to its end, a page per advance: a tap completes a page still typing, then the next one,
 * after the debounce, advances.
 */
const readPart = (t: Setup) => {
  let pages = 0;

  while (t.machine.current === "story") {
    if (t.game.session.typewriter?.done === false) {
      t.input.advance();
      t.frame();
    }

    t.wait(STORY_DEBOUNCE_MS);
    t.input.advance();
    t.frame();
    pages += 1;
    assert.ok(pages < 100, "the story never ends");
  }

  return pages;
};

/** Reads one story page: completes it if it still types, then advances after the debounce. */
const readPage = (t: Setup) => {
  const page = t.scene.page;

  if (t.game.session.typewriter?.done === false) {
    t.input.advance();
    t.frame();
  }

  t.wait(STORY_DEBOUNCE_MS);
  t.input.advance();
  t.frame();
  assert.notEqual(t.scene.page, page);
};

/** Answers the current challenge the way a player would, a frame per input. */
const answer = (t: Setup) => {
  const spec = t.scene.challenge;

  if (spec === null) {
    throw new Error("no challenge shown");
  }

  if (spec.kind === "sequence") {
    for (const dir of spec.directions) {
      t.input.press(dir);
      t.input.release(dir);
      t.frame();
    }
  } else if (spec.kind === "hold") {
    t.input.press(spec.direction);
    t.wait(TUNING.holdMs + FRAME_MS);
    t.input.release(spec.direction);
    t.frame();
  } else {
    for (let i = 0; i < TUNING.manyPresses; i++) {
      t.input.press(spec.direction);
      t.input.release(spec.direction);
      t.frame();
    }
  }
};

const playRound = (t: Setup) => {
  t.wait(TRANSITION_MS);
  assert.equal(t.machine.current, "round");

  while (t.game.session.phase === "play") {
    answer(t);
  }

  assert.equal(t.game.session.phase, "won");
  t.wait(AFTER_ROUND_MS);
  assert.equal(t.machine.current, "story");
};

describe("gate", () => {
  it("shows progress and the warning while loading, then the prompt once loaded", async () => {
    const t = setup({ auto: false });

    assert.deepEqual(t.gateView.screen, { progress: 0, warning: true, prompt: null });
    t.loader.progress[0](0.4);
    t.frame();
    assert.deepEqual(t.gateView.screen, { progress: 0.4, warning: true, prompt: null });

    t.loader.last.resolve();
    await settle();
    assert.equal(t.game.gate.phase, "loading");
    t.frame();
    assert.equal(t.game.gate.phase, "ready");
    assert.deepEqual(t.gateView.screen, { progress: null, warning: true, prompt: TAP_TO_BEGIN });
    assert.equal(t.scene.black, true);
    assert.equal(t.machine.current, "gate");
  });

  it("hides its texts until the font is in", () => {
    const t = setup({ auto: false });

    t.loader.fontReady = false;
    t.frame();
    assert.deepEqual(t.gateView.screen, { progress: 0, warning: false, prompt: null });
    t.loader.fontReady = true;
    t.frame();
    assert.equal(t.gateView.screen?.warning, true);
  });

  it("drops taps made while loading, and goes to title on a tap once ready", async () => {
    const t = setup({ auto: false });

    t.input.advance();
    t.frame();
    t.input.advance();
    t.loader.last.resolve();
    await settle();
    t.frame();
    assert.equal(t.machine.current, "gate");
    assert.deepEqual(t.input.queue, []);

    t.frame();
    assert.equal(t.machine.current, "gate");
    t.input.advance();
    t.frame();
    assert.equal(t.machine.current, "title");
    assert.equal(t.gateView.screen, null);
    assert.equal(t.scene.black, false);
  });

  it("unlocks audio and starts the music only on the begin tap", async () => {
    const t = setup({ auto: false });

    t.game.gate.activate();
    assert.deepEqual(t.audio.log, []);

    t.loader.last.resolve();
    await settle();
    t.frame();
    t.game.gate.activate();
    assert.deepEqual(t.audio.log, ["unlock", "startMusic"]);

    t.input.advance();
    t.frame();
    assert.equal(t.machine.current, "title");
    t.game.gate.activate();
    assert.deepEqual(t.audio.log, ["unlock", "startMusic"]);
  });

  it("shows the failure, and a tap retries the load", async () => {
    const t = setup({ auto: false });

    t.loader.last.reject(new Error("load failed"));
    await settle();
    t.frame();
    assert.equal(t.game.gate.phase, "failed");
    assert.deepEqual(t.gateView.screen, { progress: null, warning: true, prompt: LOAD_FAILED });

    t.game.gate.activate();
    assert.deepEqual(t.audio.log, []);
    t.input.advance();
    t.frame();
    assert.equal(t.loader.calls.length, 2);
    assert.equal(t.game.gate.phase, "loading");
    assert.deepEqual(t.gateView.screen, { progress: 0, warning: true, prompt: null });

    t.loader.last.resolve();
    await settle();
    t.frame();
    assert.equal(t.game.gate.phase, "ready");
  });

  it("shows the failure line even without the font", async () => {
    const t = setup({ auto: false });

    t.loader.fontReady = false;
    t.loader.last.reject(new Error("font failed"));
    await settle();
    t.frame();
    assert.deepEqual(t.gateView.screen, { progress: null, warning: true, prompt: LOAD_FAILED });
  });

  it("does nothing on activation once it was left", async () => {
    const t = setup();

    await settle();
    t.frame();
    t.machine.request("ending");
    t.game.gate.activate();
    assert.deepEqual(t.audio.log, []);
    assert.equal(t.loader.calls.length, 1);
  });
});

describe("title", () => {
  it("starts a new game with the title frame bare: no logo, credits or prompt until their times", async () => {
    const t = setup();

    await toTitle(t);
    assert.equal(t.game.session.games, 1);
    assert.equal(t.game.session.seed, 42);
    assert.equal(t.game.session.rounds.length, 3);
    assert.equal(t.game.session.phase, "title");
    // The logo waits for its reveal strike; the credits and the prompt for the end of the intro.
    assert.deepEqual([t.scene.logo, t.scene.credits, t.scene.prompt], [false, false, null]);
    assert.equal(t.pad.visible, false);

    t.wait(TITLE_CUES[2].at + FRAME_MS);
    assert.deepEqual([t.scene.logo, t.scene.credits, t.scene.prompt], [true, false, null]);
  });

  it("fades the credits and the prompt in at 7.25 s, and takes no tap before", async () => {
    const t = setup();

    await toTitle(t);

    const enteredAt = t.clock.now;

    t.input.press("up");
    t.frame();

    // Taps all through the intro, the last one a frame before its end: each is dropped.
    while (t.clock.now - enteredAt < TITLE_PROMPT_MS - FRAME_MS) {
      t.input.advance();
      t.frame();
    }

    assert.equal(t.machine.current, "title");
    assert.equal(t.game.session.phase, "title");
    assert.deepEqual(t.scene.callsSince(enteredAt), []);

    t.frame();
    assert.equal(t.game.session.phase, "prompt");
    assert.deepEqual(t.scene.callsSince(enteredAt), [
      `credits true@${TITLE_PROMPT_MS} ×1`,
      `prompt ${TAP_TO_BEGIN}@${TITLE_PROMPT_MS} ×1`,
    ]);
    assert.deepEqual([t.scene.credits, t.scene.prompt], [true, TAP_TO_BEGIN]);

    // A key held down before the prompt doesn't count: the prompt began an input epoch.
    t.frame();
    assert.equal(t.game.session.phase, "prompt");
    assert.equal(t.scene.callsSince(enteredAt).length, 2);
  });

  it("fades everything out over Inicio's 1 s on the tap, dropping taps meanwhile, then starts story 0", async () => {
    const t = setup();

    await toTitle(t);
    t.wait(TITLE_PROMPT_MS + 300);

    t.input.advance();
    t.frame();

    // The frame's clock tick comes before the state's update: the tap counts at this frame's time.
    const tappedAt = t.clock.now;

    assert.equal(t.game.session.phase, "leaving");
    assert.deepEqual(t.scene.callsSince(tappedAt), ["title false@0 ×1", "prompt null@0 ×1"]);

    // More taps while it fades change nothing, and the story waits for the fade's end (`FimInicio`).
    while (t.clock.now - tappedAt < TITLE_EXIT_MS - FRAME_MS) {
      t.input.advance();
      t.frame();
      assert.equal(t.machine.current, "title");
    }

    t.frame();
    assert.equal(t.machine.current, "story");
    assert.equal(t.game.session.part, 0);
    assert.equal(t.game.session.phase, "preamble");
    assert.equal(t.scene.callsSince(tappedAt).filter((call) => call.startsWith("title")).length, 2);
    assert.deepEqual([t.scene.title, t.scene.prompt], [false, null]);
  });
});

describe("story", () => {
  it("waits out part 0's preamble with the text box hidden, dropping taps", async () => {
    const t = setup();

    await toTitle(t);
    leaveTitle(t);
    t.wait(STORY_PREAMBLE_MS - 2 * FRAME_MS);
    t.input.advance();
    t.frame();
    assert.equal(t.scene.page, null);
    assert.equal(t.game.session.phase, "preamble");

    t.wait(2 * FRAME_MS);
    assert.equal(t.game.session.phase, "page");
    assert.equal((t.scene.page as StoryPage | null)?.text.startsWith("[First Mate]: "), true);
  });

  /** From Title to part 0's first page, just shown. */
  const toFirstPage = async () => {
    const t = setup();

    await toTitle(t);
    leaveTitle(t);
    t.wait(STORY_PREAMBLE_MS);
    assert.equal(t.game.session.phase, "page");

    return t;
  };

  it("types a page at about a character a frame, label first", async () => {
    const t = await toFirstPage();
    const page = t.scene.page;
    const typewriter = t.game.session.typewriter;

    assert.ok(page !== null && typewriter !== null);
    assert.ok(t.scene.revealed >= 1 && t.scene.revealed < 10, `just begun: ${t.scene.revealed}`);
    assert.ok(page.text.length > 40);

    const before = t.scene.revealed;

    t.wait(20 * FRAME_MS);
    // 20 frames of 16 ms: 320 ms at 1000/60 ms a character is 19.2 characters, 19 or 20 with the time carried in.
    assert.ok([19, 20].includes(t.scene.revealed - before), `typed ${t.scene.revealed - before}`);
    assert.equal(t.scene.page, page);

    t.wait(page.text.length * TYPE_MS_PER_CHAR);
    assert.equal(t.scene.revealed, page.text.length);
    assert.equal(snapshotSession(t.game.session).page?.typed, true);
  });

  it("completes the page on a tap while typing, and advances on the next tap after the debounce", async () => {
    const t = await toFirstPage();
    const first = t.scene.page;

    assert.ok(first !== null);
    t.input.advance();
    t.frame();
    assert.equal(t.scene.page, first, "the tap completes, it doesn't advance");
    assert.equal(t.scene.revealed, first.text.length);
    assert.equal(snapshotSession(t.game.session).page?.page, 0);

    t.wait(STORY_DEBOUNCE_MS - 2 * FRAME_MS);
    t.input.advance();
    t.frame();
    assert.equal(t.scene.page, first, "a tap within the debounce after completion is dropped");

    t.wait(2 * FRAME_MS);
    t.input.advance();
    t.input.advance();
    t.frame();
    assert.notEqual(t.scene.page, first);
    assert.equal(snapshotSession(t.game.session).page?.page, 1, "a double tap shows one page, not two");
    assert.ok(t.scene.revealed < (t.scene.page?.text.length ?? 0), "the next page types again");
  });

  it("starts the debounce when typing ends on its own", async () => {
    const t = await toFirstPage();
    const first = t.scene.page;

    assert.ok(first !== null);
    t.wait(first.text.length * TYPE_MS_PER_CHAR);
    assert.equal(snapshotSession(t.game.session).page?.typed, true);
    t.input.advance();
    t.frame();
    assert.equal(t.scene.page, first, "a tap right after typing ended is within the debounce");

    t.wait(STORY_DEBOUNCE_MS);
    t.input.advance();
    t.frame();
    assert.notEqual(t.scene.page, first);
  });

  it("types a whisper at 100 ms a character, and stops with the clock", async () => {
    const t = await toFirstPage();

    // Part 0's fourth line is the first whisper.
    while (t.scene.page?.whisper !== true) {
      readPage(t);
    }

    const whisper = t.scene.page;
    const start = t.scene.revealed;

    t.wait(10 * WHISPER_MS_PER_CHAR);
    assert.equal(t.scene.revealed - start, 10);

    t.clock.paused = true;
    t.wait(1000);
    assert.equal(t.scene.revealed - start, 10, "paused game time types nothing");
    t.clock.paused = false;

    t.wait(whisper.text.length * WHISPER_MS_PER_CHAR);
    assert.equal(t.scene.revealed, whisper.text.length);
  });

  it("keeps what shows when the layout changes mid-typing, and types on", async () => {
    const t = await toFirstPage();

    t.wait(10 * FRAME_MS);

    const shown = t.scene.revealed;

    t.scene.paging = { linesPerPage: 10, measure: fixedWidthMeasure(100) };
    t.frame();
    assert.equal(t.game.session.cursor?.pageCount, 1);
    assert.equal(t.scene.page?.text, "[First Mate]: \"Captain! This wind is too strong! We're gonna lose the sails!\"");
    assert.ok(t.scene.revealed >= shown && t.scene.revealed <= shown + 1, "never typed again from 0");
    assert.equal(snapshotSession(t.game.session).page?.typed, false);

    t.wait(10 * FRAME_MS);
    assert.ok(t.scene.revealed > shown + 5, "typing goes on");
  });

  it("completes the page when a relayout cuts it to what already shows", async () => {
    const t = await toFirstPage();

    t.wait(30 * FRAME_MS);
    assert.ok(t.scene.revealed > 20);
    t.scene.paging = { linesPerPage: 1, measure: fixedWidthMeasure(16) };
    t.frame();

    const page = t.scene.page;

    assert.ok(page !== null && page.text.length <= 16);
    assert.equal(t.scene.revealed, page.text.length);
    assert.equal(snapshotSession(t.game.session).page?.typed, true);
    t.wait(STORY_DEBOUNCE_MS);
    t.input.advance();
    t.frame();
    assert.notEqual(t.scene.page, page, "one tap advances a page completed by the relayout");
  });
});

describe("a full game", () => {
  it("plays from Title through every part and round to the Ending, then plays again without leaks", async () => {
    const t = setup();

    await toTitle(t);

    const baseline = timerCount(t.clock);

    for (let game = 1; game <= 3; game++) {
      assert.equal(t.game.session.games, game);
      leaveTitle(t);
      t.wait(STORY_PREAMBLE_MS);

      for (let part = 0; part < STORY_PARTS.length; part++) {
        assert.equal(t.machine.current, "story");
        assert.equal(t.game.session.part, part);
        assert.equal(t.pad.visible, false);
        assert.equal(t.scene.black, part === STORY_PARTS.length - 1, "the last part is read on black");
        readPart(t);

        if (part === STORY_PARTS.length - 1) {
          break;
        }

        assert.equal(t.machine.current, "transition");
        assert.deepEqual([t.pad.visible, t.pad.dimmed], [true, true]);
        playRound(t);
        assert.equal(t.scene.backdrops.has("pillars"), part >= 0);
        assert.equal(t.scene.backdrops.has("tentacles"), part >= 1);
      }

      assert.equal(t.machine.current, "ending");
      assert.equal(t.scene.boat, "broken");
      assert.equal(t.scene.black, true, "part 3's black lifts after a moment");
      assert.equal(t.pad.visible, false);

      t.wait(ENDING_MS.lift);
      assert.equal(t.scene.black, false);
      t.wait(ENDING_MS.kraken - ENDING_MS.lift);
      assert.equal(t.scene.kraken, true);
      t.wait(ENDING_MS.black - ENDING_MS.kraken);
      assert.equal(t.scene.black, true);
      t.wait(ENDING_MS.sea - ENDING_MS.black);
      assert.deepEqual(
        [t.scene.black, t.scene.kraken, t.scene.boat, t.scene.backdrops.size],
        [true, false, "none", 0],
        "FimFinal's cuts happen under full black",
      );
      t.wait(ENDING_MS.seaLift - ENDING_MS.sea);
      assert.equal(t.scene.black, false);

      // Taps before the prompt are dropped, on the card too.
      t.input.advance();
      t.frame();
      t.wait(ENDING_MS.card - ENDING_MS.seaLift);
      assert.deepEqual([t.scene.title, t.scene.prompt], [true, null]);
      t.input.advance();
      t.frame();
      assert.equal(t.machine.current, "ending");

      t.wait(ENDING_MS.replay - ENDING_MS.card);
      assert.equal(t.game.session.phase, "replay");
      assert.equal(t.scene.prompt, TAP_TO_PLAY_AGAIN);

      t.input.advance();
      t.frame();
      assert.equal(t.machine.current, "title");
      assert.equal(t.scene.boat, "whole");
      assert.equal(timerCount(t.clock), baseline, `no timer left behind after game ${game}`);
    }

    assert.deepEqual([t.game.session.games, t.game.session.seed], [4, 45], "each game has a new seed");
  });

  it("sets the bubbles per part as each part begins, eyes only between pages, none from the kraken on", async () => {
    const t = setup();

    await toTitle(t);
    assert.deepEqual(t.scene.weathers, [t.game.session.seed], "Title restarts the weather from the game's seed");
    assert.deepEqual(t.scene.undersea, ["0 0"], "never an eye on Title");
    leaveTitle(t);
    assert.deepEqual(t.scene.undersea, ["0 0", `0 ${STORY_PREAMBLE_MS}`], "an eye may show in part 0's preamble");
    t.wait(STORY_PREAMBLE_MS);

    for (let part = 0; part < STORY_PARTS.length - 1; part++) {
      readPart(t);
      playRound(t);
    }

    readPart(t);
    const between = (part: number) => [`${part} ${TRANSITION_MS}`, `${part} 0`, `${part} ${AFTER_ROUND_MS}`];

    assert.deepEqual(t.scene.undersea, [
      "0 0",
      `0 ${STORY_PREAMBLE_MS}`, "0 0", ...between(0),
      "1 0", ...between(1),
      "2 0", ...between(2),
      "3 0",
      `3 ${ENDING_MS.kraken}`,
    ], "eyes only while no text box or challenge is up; a won round's bubbles start with the next part");

    t.wait(ENDING_MS.kraken - FRAME_MS);
    assert.equal(t.scene.undersea.at(-1), `3 ${ENDING_MS.kraken}`);
    t.wait(FRAME_MS);
    assert.equal(t.scene.undersea.at(-1), "none");
    t.wait(ENDING_MS.replay - ENDING_MS.kraken);
    t.input.advance();
    t.frame();
    assert.equal(t.machine.current, "title");
    assert.deepEqual(t.scene.undersea.slice(-2), ["none", "0 0"], "a replay starts from Title's again");
    assert.deepEqual(t.scene.weathers, [t.game.session.seed - 1, t.game.session.seed]);
  });
});

describe("ending", () => {
  it("plays Fim's phases on the clock: black from 8.5 s, the card at half speed, then the prompt", async () => {
    const t = setup();

    await toTitle(t);
    leaveTitle(t);
    t.wait(STORY_PREAMBLE_MS);

    for (let part = 0; part < STORY_PARTS.length; part++) {
      if (part === STORY_PARTS.length - 1) {
        // The last part is read on black, which fades in as it starts.
        assert.deepEqual(t.scene.calls.at(-1)?.call, "black true");
        assert.equal(t.scene.calls.at(-1)?.speed, 1);
      }

      readPart(t);

      if (part < STORY_PARTS.length - 1) {
        playRound(t);
      }
    }

    assert.equal(t.machine.current, "ending");

    const enteredAt = t.clock.now;
    const phases: string[] = [];

    while (t.clock.now - enteredAt <= ENDING_MS.replay) {
      if (phases.at(-1) !== t.game.session.phase) {
        phases.push(t.game.session.phase);
      }

      t.frame();
    }

    phases.push(t.game.session.phase);

    assert.deepEqual(phases, ["boat", "thrown", "kraken", "black", "sea", "card", "replay"]);
    assert.deepEqual(t.scene.callsSince(enteredAt), [
      "boat broken@0",
      `black false@${ENDING_MS.lift} ×1`,
      `boat thrown@${ENDING_MS.thrown}`,
      `kraken true@${ENDING_MS.kraken} ×1`,
      `black true@${ENDING_MS.black} ×1`,
      `kraken false@${ENDING_MS.sea}`,
      `boat none@${ENDING_MS.sea}`,
      `pillars false@${ENDING_MS.sea}`,
      `tentacles false@${ENDING_MS.sea}`,
      `black false@${ENDING_MS.seaLift} ×1`,
      `title true@${ENDING_MS.card} ×${ENDING_CARD_SPEED}`,
      `prompt ${TAP_TO_PLAY_AGAIN}@${ENDING_MS.replay} ×1`,
    ]);
  });
});

describe("round", () => {
  const toRound = async () => {
    const t = setup();

    await toTitle(t);
    leaveTitle(t);
    t.wait(STORY_PREAMBLE_MS);
    readPart(t);
    t.wait(TRANSITION_MS);
    assert.equal(t.machine.current, "round");

    return t;
  };

  it("shows the pad undimmed, drops advances, and resets a Sequence on a wrong press", async () => {
    const t = await toRound();

    assert.deepEqual([t.pad.visible, t.pad.dimmed], [true, false]);

    while (t.scene.challenge?.kind !== "sequence") {
      answer(t);
    }

    const [first, second] = t.scene.challenge.directions;
    const wrong = (["up", "down", "left", "right"] as const).find((dir) => dir !== first && dir !== second);

    if (wrong === undefined) {
      throw new Error("unreachable");
    }

    t.input.advance();
    t.input.press(first);
    t.frame();
    assert.deepEqual(t.scene.progress, { kind: "sequence", pointer: 1, length: 3 });

    t.input.press(wrong);
    t.frame();
    assert.deepEqual(t.scene.progress, { kind: "sequence", pointer: 0, length: 3 });
    assert.equal(t.scene.shakes, 1, "a wrong key shakes the arrows");
  });

  it("fades the round's backdrop in from the win, then starts the next part after the wait", async () => {
    const t = await toRound();

    while (t.game.session.phase === "play") {
      answer(t);
    }

    const wonAt = t.scene.calls.at(-1)?.at ?? NaN;

    assert.deepEqual(t.scene.calls.at(-1), { at: wonAt, call: "pillars true", speed: 1 });
    t.wait(AFTER_ROUND_MS - (t.clock.now - wonAt) - FRAME_MS);
    assert.equal(t.machine.current, "round");
    t.wait(2 * FRAME_MS);
    assert.equal(t.machine.current, "story");
  });

  it("hints the direction of a Hold and releases it on cancel", async () => {
    const t = await toRound();

    while (t.scene.challenge?.kind !== "hold") {
      answer(t);
    }

    const { direction } = t.scene.challenge;

    assert.equal(t.pad.hint, direction);
    t.input.press(direction);
    t.wait(TUNING.holdMs / 2);
    assert.equal(t.scene.progress?.kind === "hold" && t.scene.progress.held, true);

    t.input.queue.push({ kind: "cancel" });
    t.frame();
    assert.deepEqual(t.scene.progress, { kind: "hold", held: false, fraction: 0 });
  });
});

describe("frame stepper", () => {
  const holdAlmostDone = async () => {
    const t = setup();

    await toTitle(t);
    leaveTitle(t);
    t.wait(STORY_PREAMBLE_MS);
    readPart(t);
    t.wait(TRANSITION_MS);

    while (t.scene.challenge?.kind !== "hold") {
      answer(t);
    }

    const { direction } = t.scene.challenge;

    t.input.press(direction);
    t.frame();
    t.wait(TUNING.holdMs - 50);
    // The tab hides here: the router queues a cancel, and no frame runs until it is visible again.
    t.input.queue.push({ kind: "cancel" });

    return t;
  };

  it("without the guard, the first resumed tick completes a Hold that was let go", async () => {
    const t = await holdAlmostDone();
    const stepper = createFrameStepper(t.machine);

    stepper.step(100);
    assert.notEqual(t.scene.challenge?.kind, "hold");
  });

  it("with the guard, the queued cancel is applied before any time passes", async () => {
    const t = await holdAlmostDone();
    const stepper = createFrameStepper(t.machine);
    const before = t.clock.now;

    stepper.resume();
    stepper.step(100);
    assert.equal(t.clock.now, before, "the resumed frame adds no time");
    assert.equal(t.scene.challenge?.kind, "hold");
    assert.deepEqual(t.scene.progress, { kind: "hold", held: false, fraction: 0 });

    stepper.step(100);
    assert.equal(t.clock.now, before + 100);
    assert.equal(t.scene.challenge?.kind, "hold");
  });
});

describe("cues", () => {
  const cuesOf = (t: Setup, state: string) =>
    t.cues.filter((cue) => cue.state === state).map(({ name, at }) => ({ name, at }));

  /** The ambient strikes' times on Title (ms from its enter), as the original's timer gives them for `seed`. */
  const expectedAmbient = (seed: number, count: number) => {
    const rng = createRng((seed ^ AMBIENT_SALT) >>> 0);
    const times: number[] = [];
    let at = TITLE_AMBIENT.from + ambientDelay(rng, TITLE_AMBIENT.first);

    for (let i = 0; i < count; i++) {
      times.push(at);
      at += ambientDelay(rng, TITLE_AMBIENT.next);
    }

    return times;
  };

  it("draws the ambient delays in whole seconds: 5–7 s after the intro, then 7–10 s apart", () => {
    const rng = createRng(7);
    const firsts = new Set<number>();
    const nexts = new Set<number>();

    for (let i = 0; i < 500; i++) {
      firsts.add(ambientDelay(rng, TITLE_AMBIENT.first));
      nexts.add(ambientDelay(rng, TITLE_AMBIENT.next));
    }

    assert.deepEqual([...firsts].sort((a, b) => a - b), [5000, 6000, 7000]);
    assert.deepEqual([...nexts].sort((a, b) => a - b), [7000, 8000, 9000, 10000]);
  });

  it("plays Title's intro strikes, then ambient lightning from the game's seed, until Title is left", async () => {
    const t = setup();

    await toTitle(t);

    const ambient = expectedAmbient(t.game.session.seed, 3);

    t.wait((ambient[2] ?? 0) + FRAME_MS);
    assert.deepEqual(cuesOf(t, "title"), [
      { name: "lightning", at: 2000 },
      { name: "lightning", at: 3250 },
      { name: "title-reveal", at: 5250 },
      ...ambient.map((at) => ({ name: "lightning", at })),
    ]);
    assert.deepEqual(t.audio.sfx, Array(6).fill("thunderclap"));

    const fired = t.cues.length;

    t.input.advance();
    t.frame();
    t.wait(TITLE_EXIT_MS);
    assert.equal(t.machine.current, "story");
    t.wait(30_000);
    assert.equal(cuesOf(t, "title").length, fired, "no Title cue after Title");
  });

  it("strikes on every lightning and title-reveal cue, drawn from the game's lightning stream", async () => {
    const t = setup();

    await toTitle(t);

    const { seed } = t.game.session;

    t.wait(TITLE_CUES[1].at + FRAME_MS);
    assert.equal(t.scene.logo, false, "no logo before the reveal");
    t.wait(TITLE_CUES[2].at - TITLE_CUES[1].at);
    assert.equal(t.scene.logo, true, "the reveal shows the logo");

    t.wait(TITLE_PROMPT_MS - TITLE_CUES[2].at);
    t.input.advance();
    t.frame();
    assert.equal(t.scene.logo, false);
    t.wait(TITLE_EXIT_MS + STORY_PREAMBLE_MS);

    // The same draws, in the same order, from seed ^ LIGHTNING_SALT, apart from the rounds' and the ambient's.
    const rng = createRng((seed ^ LIGHTNING_SALT) >>> 0);
    const kinds: StrikeKind[] = ["lightning", "lightning", "title-reveal", "lightning"];

    assert.deepEqual(t.scene.strikes, kinds.map((kind) => drawStrike(kind, rng)));
    assert.deepEqual(cuesOf(t, "story"), [{ name: "lightning", at: 1250 }]);
  });

  it("draws the same strikes for the same seed and different ones for another game", async () => {
    const strikesOf = async () => {
      const t = setup();

      await toTitle(t);
      t.wait(TITLE_CUES[2].at + FRAME_MS);

      return t.scene.strikes;
    };
    const first = await strikesOf();

    assert.deepEqual(await strikesOf(), first);
    assert.equal(first.length, 3);

    const t = setup();

    await toTitle(t);
    t.wait(500);
    // Replay to game 2 the quick way: a new Title enter starts a new game with the next seed.
    t.machine.request("title");
    t.frame();
    assert.equal(t.game.session.games, 2);
    t.wait(TITLE_CUES[2].at + FRAME_MS);
    assert.notDeepEqual(t.scene.strikes, first);
  });

  it("drops Title's pending ambient strike when it is left, and goes on striking through the exit fade", async () => {
    const t = setup();

    await toTitle(t);

    const [first] = expectedAmbient(t.game.session.seed, 1);

    // Tapped so that the exit ends just after the first ambient strike: it fires while Title fades out.
    t.wait(first - TITLE_EXIT_MS + FRAME_MS);
    t.input.advance();
    t.frame();
    t.wait(TITLE_EXIT_MS);
    assert.equal(t.machine.current, "story");
    assert.deepEqual(cuesOf(t, "title").at(-1), { name: "lightning", at: first });

    const fired = cuesOf(t, "title").length;

    t.wait(30_000);
    assert.equal(cuesOf(t, "title").length, fired);
  });

  it("keeps one Title timer pending, plus the exit timer while leaving, for the leak check", async () => {
    const t = setup();

    await toTitle(t);

    for (let i = 0; i < 40; i++) {
      assert.equal(t.clock.pendingTimers, 1);
      t.wait(1000);
    }

    // Leaving adds the exit timer, and the ambient strikes go on meanwhile.
    t.input.advance();
    t.frame();
    assert.equal(t.game.session.phase, "leaving");

    for (let elapsed = 0; elapsed < TITLE_EXIT_MS - FRAME_MS; elapsed += FRAME_MS) {
      assert.equal(t.clock.pendingTimers, 2);
      t.frame();
    }
  });

  it("strikes in part 0's preamble and each Transition, roars in the Ending, and sets the music per part", async () => {
    const t = setup();

    await toTitle(t);

    for (let game = 1; game <= 2; game++) {
      t.wait(TITLE_PROMPT_MS);
      t.cues.length = 0;
      t.input.advance();
      t.frame();
      t.wait(TITLE_EXIT_MS);
      assert.deepEqual(t.audio.parts.slice(-1), [0], "Story 0 asks for part 0's music, on replay too");
      t.wait(STORY_PREAMBLE_MS);

      for (let part = 0; part < STORY_PARTS.length; part++) {
        assert.equal(t.audio.parts.at(-1), part);
        readPart(t);

        if (part < STORY_PARTS.length - 1) {
          playRound(t);
        }
      }

      t.wait(ENDING_MS.replay);
      assert.deepEqual(t.cues.map(({ name, state, at }) => ({ name, state, at })), [
        { name: "lightning", state: "story", at: 1250 },
        ...Array.from({ length: 3 }, () => ({ name: "lightning", state: "transition", at: 167 })),
        { name: "kraken", state: "ending", at: 1500 },
      ]);
      assert.equal(t.audio.sfx.at(-1), "kraken");

      t.input.advance();
      t.frame();
      assert.equal(t.machine.current, "title");
    }

    assert.deepEqual(t.audio.parts, [0, 1, 2, 3, 0, 1, 2, 3], "Title and the Ending leave the music alone");
  });
});

describe("endless", () => {
  const INTRO = ENDLESS_LINES.intro[0].text;
  const EAT = ENDLESS_LINES.eat[0].text;

  /** From Title's prompt, the icon's tap and the exit fade: endless mode's `intro`. */
  const toEndless = async () => {
    const t = setup();

    await toTitle(t);
    t.wait(TITLE_PROMPT_MS);
    t.input.endless();
    t.frame();
    assert.equal(t.game.session.phase, "leaving");
    t.wait(TITLE_EXIT_MS);
    assert.equal(t.machine.current, "endless");

    return t;
  };

  /** Reads "... follow ...": a tap completes it, a tap after the debounce plays. */
  const intro = (t: Setup) => {
    t.input.advance();
    t.frame();
    t.wait(STORY_DEBOUNCE_MS);
    t.input.advance();
    t.frame();
    assert.equal(t.game.session.phase, "play");
  };

  /** Answers the challenge up, then waits out the pause before the next. */
  const clear = (t: Setup) => {
    const level = t.game.session.level;

    answer(t);
    assert.equal(t.game.session.level, level + 1);
    t.wait(ENDLESS_TUNING.betweenMs);
    assert.equal(t.game.session.phase, "play");
  };

  it("opens from Title's icon with \"... follow ...\" in the voice's style, then a timed Sequence", async () => {
    const t = await toEndless();

    assert.deepEqual([t.game.session.mode, t.game.session.phase, t.game.session.level], ["endless", "intro", 0]);
    assert.equal(t.scene.page?.text, INTRO);
    assert.equal(t.scene.page?.whisper, true);
    assert.equal(t.pad.visible, false);

    intro(t);

    const spec = t.scene.challenge;

    assert.equal(t.scene.page, null);
    assert.deepEqual([t.pad.visible, t.pad.dimmed], [true, false]);
    assert.ok(spec?.kind === "sequence" && spec.directions.length === 3);
    assert.equal(t.game.session.timed?.limitMs, 3700);
  });

  it("offers the icon on Title's prompt only, and highlights it on the Ending's replay prompt", async () => {
    const t = setup();

    await toTitle(t);
    assert.equal(t.endlessIcon.available, false);
    t.wait(TITLE_PROMPT_MS);
    assert.deepEqual([t.endlessIcon.available, t.endlessIcon.highlighted], [true, false]);
    leaveTitle(t);
    assert.equal(t.endlessIcon.available, false);
    t.wait(STORY_PREAMBLE_MS);

    for (let part = 0; part < STORY_PARTS.length; part++) {
      readPart(t);

      if (part < STORY_PARTS.length - 1) {
        playRound(t);
      }
    }

    t.wait(ENDING_MS.replay - FRAME_MS);
    assert.equal(t.endlessIcon.available, false);
    t.wait(FRAME_MS * 2);
    assert.deepEqual([t.endlessIcon.available, t.endlessIcon.highlighted], [true, true]);
    assert.equal(t.scene.prompt, TAP_TO_PLAY_AGAIN);
    t.input.advance();
    t.frame();
    assert.equal(t.machine.current, "title");
    assert.equal(t.endlessIcon.available, false);
  });

  it("shows the time left under the challenge, and none once it is cleared", async () => {
    const t = await toEndless();

    assert.equal(t.scene.timeLeft, null);
    intro(t);
    t.wait(1000);

    const limit = t.game.session.timed?.limitMs ?? NaN;

    assert.ok(Math.abs((t.scene.timeLeft ?? NaN) - (limit - 1008) / limit) < 0.01, `${t.scene.timeLeft}`);
    answer(t);
    assert.equal(t.scene.timeLeft, null);
  });

  it("ignores the icon's tap before Title's prompt, and a story tap afterwards plays the story", async () => {
    const t = setup();

    await toTitle(t);
    t.input.endless();
    t.frame();
    assert.equal(t.game.session.phase, "title");
    leaveTitle(t);
    assert.equal(t.game.session.mode, "story");
  });

  it("gives a new challenge and a fresh limit after each one cleared, and the level rises", async () => {
    const t = await toEndless();

    intro(t);
    clear(t);
    assert.deepEqual([t.pad.dimmed, t.game.session.level], [false, 1]);

    const timed = t.game.session.timed;

    // The new challenge came within the last frame of the pause.
    assert.ok(timed !== null && timed.remainingMs > timed.limitMs - FRAME_MS);
    clear(t);
    assert.equal(t.game.session.level, 2);
  });

  it("steps the music, the bubbles and the backdrops up at levels 5, 10 and 15", async () => {
    const t = await toEndless();

    intro(t);

    while (t.game.session.level < 15) {
      clear(t);
    }

    assert.deepEqual(t.audio.parts.slice(-4), [0, 1, 2, 3]);
    assert.deepEqual([...t.scene.backdrops].sort(), ["pillars", "tentacles"]);
    assert.equal(t.game.session.part, 3);
  });

  it("on a timeout: black, \"... eat ...\", the kraken, then straight back to Title at level 0", async () => {
    const t = await toEndless();

    intro(t);
    clear(t);

    const limit = t.game.session.timed?.limitMs ?? 0;

    t.wait(limit);
    assert.equal(t.game.session.phase, "caught");
    assert.deepEqual([t.pad.visible, t.scene.challenge, t.scene.black], [false, null, true]);
    t.input.advance();
    t.wait(CAUGHT_EAT_MS);
    assert.equal(t.scene.page?.text, EAT);

    const typedBy = t.clock.now + EAT.length * WHISPER_MS_PER_CHAR + CAUGHT_HOLD_MS + FRAME_MS * 2;

    while (t.machine.current === "endless") {
      assert.ok(t.clock.now <= typedBy, "the Ending never came");
      t.frame();
    }

    assert.equal(t.machine.current, "ending");

    const enteredAt = t.clock.now;

    t.wait(ENDLESS_TITLE_MS - FRAME_MS);
    assert.equal(t.machine.current, "ending");
    assert.ok(t.cues.some(({ name, state }) => name === "kraken" && state === "ending"));
    // No card and no prompt.
    assert.ok(!t.scene.callsSince(enteredAt).some((call) => /^(title true|prompt)/.test(call)));
    t.wait(FRAME_MS * 2);
    assert.equal(t.machine.current, "title");
    assert.deepEqual([t.game.session.mode, t.game.session.level], ["story", 0]);
  });

  it("snapshots the mode, the level, the challenge and its timer for window.debug", async () => {
    const t = await toEndless();

    intro(t);
    clear(t);

    const snapshot = snapshotSession(t.game.session);

    assert.deepEqual([snapshot.mode, snapshot.level, snapshot.challenge?.index, snapshot.challenge?.count], [
      "endless", 1, 1, 0,
    ]);
    assert.equal(snapshot.challenge?.spec, t.scene.challenge);
    assert.equal(snapshot.timer?.limitMs, t.game.session.timed?.limitMs);
    t.wait(snapshot.timer?.limitMs ?? 0);
    assert.deepEqual([snapshotSession(t.game.session).challenge, snapshotSession(t.game.session).timer], [null, null]);
  });

  it("shakes the arrows on a wrong key", async () => {
    const t = await toEndless();

    intro(t);

    const spec = t.scene.challenge;

    if (spec?.kind !== "sequence") {
      throw new Error("level 0 is a Sequence");
    }

    const wrong = (["up", "down", "left", "right"] as const).find((dir) => dir !== spec.directions[0]);

    t.input.press(wrong ?? "up");
    t.frame();
    assert.equal(t.scene.shakes, 1);
  });

  it("restarts the limit with the challenge on the pause's resume", async () => {
    const t = await toEndless();

    intro(t);
    t.wait(1000);
    t.game.resetChallenge();
    assert.equal(t.game.session.timed?.remainingMs, t.game.session.timed?.limitMs);
  });

  it("starts from the Ending's replay prompt as a new game, after the card fades out", async () => {
    const t = setup();

    await toTitle(t);
    leaveTitle(t);
    t.wait(STORY_PREAMBLE_MS);

    for (let part = 0; part < STORY_PARTS.length; part++) {
      readPart(t);

      if (part < STORY_PARTS.length - 1) {
        playRound(t);
      }
    }

    t.wait(ENDING_MS.replay);
    assert.equal(t.game.session.phase, "replay");

    const games = t.game.session.games;

    t.input.endless();
    t.frame();
    assert.equal(t.game.session.phase, "leaving");
    assert.deepEqual([t.scene.logo, t.scene.prompt], [false, null]);
    t.wait(TITLE_EXIT_MS);
    assert.equal(t.machine.current, "endless");
    assert.deepEqual([t.game.session.mode, t.game.session.games, t.game.session.level], ["endless", games + 1, 0]);
    assert.equal(t.scene.boat, "whole");
    assert.equal(t.scene.page?.text, INTRO);
  });

  it("replays the same challenges from the same seed", async () => {
    const run = async () => {
      const t = await toEndless();
      const specs = [];

      intro(t);

      for (let i = 0; i < 6; i++) {
        specs.push(t.scene.challenge);
        clear(t);
      }

      return specs;
    };

    assert.deepEqual(await run(), await run());
  });
});
