// Inactivity timer used to wipe decrypted notes from memory. Timer functions are injectable so
// tests can run without real time.

/** Reads a stored auto-lock preference; a missing or unknown value falls back to the default. */
export function parseLockMinutes(raw, { choices, fallback }) {
  // Number(null) and Number("") are 0, which would silently mean "never lock".
  if (raw === null || raw === undefined || raw === "") return fallback;
  const minutes = Number(raw);
  return choices.includes(minutes) ? minutes : fallback;
}

const assertValidTimeout = (ms) => {
  if (!Number.isFinite(ms) || ms < 0) throw new RangeError(`Invalid idle timeout: ${ms}`);
};

export function createIdleLock({ timeoutMs, onLock, setTimer = setTimeout, clearTimer = clearTimeout }) {
  assertValidTimeout(timeoutMs);
  let currentMs = timeoutMs;
  let running = false;
  let handle = null;

  const clear = () => {
    if (handle !== null) {
      clearTimer(handle);
      handle = null;
    }
  };

  // A timeout of 0 means "never lock".
  const arm = () => {
    clear();
    if (!running || currentMs === 0) return;
    handle = setTimer(() => {
      handle = null;
      onLock();
    }, currentMs);
  };

  return {
    start() { running = true; arm(); },
    stop() { running = false; clear(); },
    /** Call on user activity; restarts the countdown while running. */
    touch() { if (running) arm(); },
    setTimeoutMs(next) { assertValidTimeout(next); currentMs = next; arm(); },
    isArmed: () => handle !== null,
  };
}
