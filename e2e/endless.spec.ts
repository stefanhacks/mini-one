// Endless mode end to end (endless-plan.md): the icon on Title's prompt, "... follow ...", two timed challenges
// answered, a timeout, "... eat ...", the kraken, and back to Title at level 0. Written by Claude Code.
import { expect, test } from "@playwright/test";
import { ENDLESS_LINES } from "../src/game/story/script.ts";
import {
  FAST,
  SLOW,
  keyboardDriver,
  openGame,
  readCues,
  readGame,
  setTimescale,
  waitFor,
} from "./game.ts";

test("opens from the icon, plays timed challenges, and a timeout ends the run with the kraken", async ({ page }) => {
  await openGame(page);

  const driver = await keyboardDriver(page);

  await waitFor(page, (game) => game.state === "title" && game.phase === "prompt");

  const rect = await page.evaluate(() => window.debug.router.endlessRect);

  if (rect === null) {
    throw new Error("no endless-mode icon in this layout");
  }

  // A real tap on the icon, not the E key: it must hit the corner square, not the pads.
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await waitFor(page, (game) => game.state === "endless" && game.page !== null);
  expect((await readGame(page)).page?.text).toBe(ENDLESS_LINES.intro[0].text);
  expect((await readGame(page)).mode).toBe("endless");

  // From here game time runs at SLOW until the timeout: at FAST, a 3.7 s limit is about 115 ms of wall time, which a
  // loaded machine can miss before the test reads the challenge.
  await setTimescale(page, SLOW);

  // The whisper: a tap completes it, then a tap after the debounce goes on.
  await expect.poll(async () => {
    const game = await readGame(page);

    if (game.phase === "intro") {
      await driver.advance();
      await page.waitForTimeout(30);
    }

    return (await readGame(page)).phase;
  }, { timeout: 15_000 }).toBe("play");

  // Below level 3 every challenge is a Sequence: answered at SLOW time, well inside its limit.
  // `answerChallenge` isn't used: it goes back to FAST once a challenge is answered.
  for (let level = 0; level < 2; level++) {
    const { challenge, timer } = await readGame(page);

    if (challenge?.spec.kind !== "sequence") {
      throw new Error(`expected a Sequence at level ${level}, got ${JSON.stringify(challenge)}`);
    }

    expect(timer?.remainingMs).toBeGreaterThan(0);
    await driver.tapAll(challenge.spec.directions);
    await waitFor(page, (now) => now.level === level + 1 && now.phase === "play");
  }

  // Nothing pressed: the limit runs out. At scale 1, not FAST: at FAST the timeout, "... eat ..." and the hold after it
  // all pass in about 120 ms of wall time, too short to poll for. The limit takes about 3.6 s.
  await setTimescale(page, 1);
  await waitFor(page, (game) => game.phase === "caught");
  await waitFor(page, (game) => game.page?.text === ENDLESS_LINES.eat[0].text);
  await setTimescale(page, FAST);
  await waitFor(page, (game) => game.state === "ending");
  await waitFor(page, (game) => game.state === "title");

  const cues = await readCues(page);

  expect(cues.some(({ name, state }) => name === "kraken" && state === "ending")).toBe(true);

  const back = await readGame(page);

  expect([back.mode, back.level, back.games]).toEqual(["story", 0, 2]);
});
