import assert from "node:assert/strict";
import test from "node:test";
import "../src/game.js";
const { createReactionGame, PHASE } = globalThis.F1StartTimerGame;

class FakeScheduler {
  nowMs = 0;
  nextId = 1;
  timers = new Map();
  frames = new Map();

  now = () => this.nowMs;
  schedule = (callback, delay) => {
    const id = this.nextId++;
    this.timers.set(id, { callback, at: this.nowMs + delay });
    return id;
  };
  unschedule = (id) => { this.timers.delete(id); };
  requestFrame = (callback) => {
    const id = this.nextId++;
    this.frames.set(id, callback);
    return id;
  };
  cancelFrame = (id) => { this.frames.delete(id); };
  advance(milliseconds) {
    const target = this.nowMs + milliseconds;
    for (;;) {
      let next = null;
      let idToFire = null;
      for (const [id, timer] of this.timers) {
        if (timer.at <= target && (next === null || timer.at < next.at)) {
          next = timer;
          idToFire = id;
        }
      }
      if (next === null) break;
      this.timers.delete(idToFire);
      this.nowMs = next.at;
      next.callback();
    }
    this.nowMs = target;
  }
  paint() {
    const callbacks = [...this.frames.values()];
    this.frames.clear();
    for (const callback of callbacks) callback(this.nowMs);
  }
}

function setup(random = () => 0) {
  const scheduler = new FakeScheduler();
  const history = [];
  const game = createReactionGame({
    now: scheduler.now,
    schedule: scheduler.schedule,
    unschedule: scheduler.unschedule,
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    random,
    onChange: (state) => history.push(state),
  });
  return { scheduler, game, history };
}

test("five lights ignite at one-second intervals, then randomized lights-out on a frame", () => {
  const { scheduler, game } = setup();
  assert.equal(game.activate().type, "started");
  assert.deepEqual(game.getState(), { phase: PHASE.LIGHTING, litCount: 1, resultMs: null });
  for (let n = 2; n <= 5; n++) {
    scheduler.advance(1000);
    assert.equal(game.getState().litCount, n);
    assert.equal(game.getState().phase, PHASE.LIGHTING);
  }
  scheduler.advance(199);
  assert.equal(game.getState().litCount, 5);
  scheduler.advance(1);
  // Timer is done; the light state changes in a rendering frame, not the timer callback.
  assert.equal(game.getState().phase, PHASE.LIGHTING);
  assert.equal(scheduler.frames.size, 1);
  scheduler.paint();
  assert.equal(game.getState().phase, PHASE.READY);
  assert.equal(game.getState().litCount, 0);
});

test("random range runs from 200 to 3000 ms after the fifth light", () => {
  for (const [randomValue, extraDelay] of [[0, 200], [0.5, 1600], [1, 3000]]) {
    const { scheduler, game } = setup(() => randomValue);
    game.activate();
    scheduler.advance(4000 + extraDelay - 1);
    assert.equal(scheduler.frames.size, 0);
    scheduler.advance(1);
    assert.equal(scheduler.frames.size, 1);
    scheduler.paint();
    assert.equal(game.getState().phase, PHASE.READY);
  }
});

test("early activation immediately turns all lights off and stops every timer", () => {
  const { scheduler, game } = setup();
  game.activate();
  scheduler.advance(2000);
  assert.equal(game.getState().litCount, 3);
  assert.equal(game.activate().type, "false-start");
  assert.equal(game.getState().phase, PHASE.FALSE_START);
  assert.equal(game.getState().litCount, 0);
  assert.equal(scheduler.timers.size, 0);
  scheduler.advance(50000);
  scheduler.paint();
  assert.equal(game.getState().phase, PHASE.FALSE_START);
  assert.equal(game.activate().type, "started");
  assert.equal(game.getState().litCount, 1);
});

test("reaction is measured using the injected monotonic clock and can be replayed", () => {
  const { scheduler, game } = setup();
  game.activate();
  scheduler.advance(4200);
  scheduler.paint();
  scheduler.advance(247.375);
  assert.deepEqual(game.activate(), { type: "result", resultMs: 247.375 });
  assert.equal(game.getState().phase, PHASE.RESULT);
  assert.equal(game.getState().resultMs, 247.375);
  scheduler.advance(35000);
  assert.equal(game.getState().resultMs, 247.375);
  game.activate();
  assert.equal(game.getState().resultMs, null);
  assert.equal(game.getState().litCount, 1);
});

test("switching tabs interrupts lighting, ready and pending frame", () => {
  for (const milliseconds of [2000, 4200, 4250]) {
    const { scheduler, game } = setup();
    game.activate();
    scheduler.advance(milliseconds);
    if (milliseconds === 4250) scheduler.paint();
    assert.equal(game.interrupt(), true);
    assert.equal(game.getState().phase, PHASE.INTERRUPTED);
    assert.equal(game.getState().litCount, 0);
    scheduler.advance(20000);
    scheduler.paint();
    assert.equal(game.getState().phase, PHASE.INTERRUPTED);
    assert.equal(scheduler.frames.size, 0);
    assert.equal(scheduler.timers.size, 0);
    assert.equal(game.activate().type, "started");
  }
});

test("dispose cancels queued callbacks and prevents new games", () => {
  const { scheduler, game } = setup();
  game.activate();
  scheduler.advance(4200);
  game.dispose();
  game.dispose();
  scheduler.paint();
  assert.equal(game.getState().phase, PHASE.LIGHTING);
  assert.equal(game.activate().type, "ignored");
  assert.equal(scheduler.frames.size, 0);
  assert.equal(scheduler.timers.size, 0);
});

test("invalid timing is rejected and a duplicate start cannot create extra timers", () => {
  assert.throws(() => createReactionGame({ timing: {
    lightIntervalMs: 1000, lightsOutMinMs: 3000, lightsOutMaxMs: 200,
  } }), RangeError);
  const { scheduler, game } = setup();
  assert.equal(game.start(), true);
  assert.equal(game.start(), false);
  assert.equal(scheduler.timers.size, 1);
});
