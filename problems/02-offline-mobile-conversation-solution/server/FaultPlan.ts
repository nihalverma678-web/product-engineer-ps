export interface Faults {
  /** Respond 503 before storing anything (a temporary failure). */
  failNext: number;
  /** Respond 422 (a permanent rejection). */
  rejectNext: number;
  /** Store the message, then cut the connection without answering (lost acknowledgement). */
  dropAckNext: number;
  /** Delay every request by this many ms (slow network). */
  latencyMs: number;
}

export type CountedFault = 'failNext' | 'rejectNext' | 'dropAckNext';

/** Scripted misbehaviour for the mock backend. Counters decrement as they are used. */
export class FaultPlan {
  private f: Faults = { failNext: 0, rejectNext: 0, dropAckNext: 0, latencyMs: 0 };

  set(partial: Partial<Faults>): void {
    for (const [k, v] of Object.entries(partial)) {
      if (k in this.f && typeof v === 'number' && v >= 0) (this.f as unknown as Record<string, number>)[k] = v;
    }
  }

  /** Returns true (and decrements) if this kind of fault should fire now. */
  consume(kind: CountedFault): boolean {
    if (this.f[kind] > 0) {
      this.f[kind]--;
      return true;
    }
    return false;
  }

  get latencyMs(): number {
    return this.f.latencyMs;
  }

  snapshot(): Faults {
    return { ...this.f };
  }

  reset(): void {
    this.f = { failNext: 0, rejectNext: 0, dropAckNext: 0, latencyMs: 0 };
  }
}
