/** Injected so tests can control time and backoff timers deterministically. */
export interface Clock {
  now(): number;
  /** Schedules fn after ms; returns a cancel function. */
  setTimeout(fn: () => void, ms: number): () => void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    const handle = setTimeout(fn, ms);
    return () => clearTimeout(handle);
  },
};
