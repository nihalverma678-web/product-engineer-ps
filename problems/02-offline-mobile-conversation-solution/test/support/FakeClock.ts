import type { Clock } from '../../src/sync/Clock';

/** Manual clock: time only moves when the test says so. */
export class FakeClock implements Clock {
  private t: number;
  private timers: { at: number; fn: () => void }[] = [];

  constructor(start = 1_000_000) {
    this.t = start;
  }

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): () => void {
    const timer = { at: this.t + ms, fn };
    this.timers.push(timer);
    return () => {
      this.timers = this.timers.filter((x) => x !== timer);
    };
  }

  hasTimers(): boolean {
    return this.timers.length > 0;
  }

  /** Jump to the earliest scheduled timer and fire it. */
  advanceToNext(): void {
    if (!this.timers.length) return;
    this.timers.sort((a, b) => a.at - b.at);
    const [next] = this.timers.splice(0, 1);
    this.t = Math.max(this.t, next.at);
    next.fn();
  }
}
