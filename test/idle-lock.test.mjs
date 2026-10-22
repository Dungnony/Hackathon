import test from "node:test";
import assert from "node:assert/strict";
import { createIdleLock, parseLockMinutes } from "../src/lib/idle-lock.js";

// Deterministic stand-in for setTimeout/clearTimeout.
function fakeTimers() {
  let nextId = 1;
  const active = new Map();
  return {
    setTimer: (fn, ms) => { const id = nextId++; active.set(id, { fn, ms }); return id; },
    clearTimer: (id) => { active.delete(id); },
    fire() { const [id, timer] = [...active][0]; active.delete(id); timer.fn(); },
    get pending() { return active.size; },
    get lastMs() { return [...active.values()].at(-1)?.ms; },
  };
}

const setup = (timeoutMs = 1000) => {
  const timers = fakeTimers();
  let locks = 0;
  const lock = createIdleLock({ timeoutMs, onLock: () => { locks += 1; }, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  return { timers, lock, locks: () => locks };
};

test("start arms the timer and firing locks exactly once", () => {
  const { timers, lock, locks } = setup(1000);
  lock.start();
  assert.equal(timers.pending, 1);
  assert.equal(timers.lastMs, 1000);
  timers.fire();
  assert.equal(locks(), 1);
  assert.equal(lock.isArmed(), false);
});

test("touch restarts the countdown instead of stacking timers", () => {
  const { timers, lock } = setup();
  lock.start();
  lock.touch();
  lock.touch();
  assert.equal(timers.pending, 1);
});

test("touch before start does nothing", () => {
  const { timers, lock } = setup();
  lock.touch();
  assert.equal(timers.pending, 0);
});

test("stop cancels the timer and later touches stay inert", () => {
  const { timers, lock, locks } = setup();
  lock.start();
  lock.stop();
  lock.touch();
  assert.equal(timers.pending, 0);
  assert.equal(locks(), 0);
});

test("a timeout of 0 means never lock", () => {
  const { timers, lock } = setup(0);
  lock.start();
  lock.touch();
  assert.equal(timers.pending, 0);
});

test("setTimeoutMs re-arms with the new duration while running", () => {
  const { timers, lock } = setup(1000);
  lock.start();
  lock.setTimeoutMs(5000);
  assert.equal(timers.pending, 1);
  assert.equal(timers.lastMs, 5000);
  lock.setTimeoutMs(0);
  assert.equal(timers.pending, 0);
});

test("setTimeoutMs while stopped does not start the timer", () => {
  const { timers, lock } = setup(1000);
  lock.setTimeoutMs(2000);
  assert.equal(timers.pending, 0);
});

const LOCK_OPTIONS = { choices: [0, 1, 5, 15], fallback: 5 };

// Regression: Number(null) is 0, which used to turn auto-lock off for every new user.
test("parseLockMinutes falls back to the default when nothing is stored", () => {
  assert.equal(parseLockMinutes(null, LOCK_OPTIONS), 5);
  assert.equal(parseLockMinutes("", LOCK_OPTIONS), 5);
});

test("parseLockMinutes keeps a stored choice, including 0 for off", () => {
  assert.equal(parseLockMinutes("15", LOCK_OPTIONS), 15);
  assert.equal(parseLockMinutes("0", LOCK_OPTIONS), 0);
});

test("parseLockMinutes ignores values that are not offered choices", () => {
  assert.equal(parseLockMinutes("7", LOCK_OPTIONS), 5);
  assert.equal(parseLockMinutes("abc", LOCK_OPTIONS), 5);
});

test("invalid timeouts are rejected", () => {
  assert.throws(() => createIdleLock({ timeoutMs: -1, onLock() {} }), RangeError);
  assert.throws(() => createIdleLock({ timeoutMs: Number.NaN, onLock() {} }), RangeError);
  const { lock } = setup();
  assert.throws(() => lock.setTimeoutMs("5"), RangeError);
});
