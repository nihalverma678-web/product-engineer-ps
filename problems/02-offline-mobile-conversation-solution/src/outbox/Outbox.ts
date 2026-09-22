import { newMessageId } from '../domain/id';
import { MAX_MESSAGE_LENGTH } from '../domain/limits';
import { assertTransition } from '../domain/stateMachine';
import type { DeliveryState, OutboxMessage } from '../domain/types';
import type { Clock } from '../sync/Clock';

/** Dumb durable storage. All rules live in Outbox; a store only persists rows. */
export interface OutboxStore {
  loadAll(): Promise<OutboxMessage[]>;
  /** Insert or replace one message atomically. Must be durable when the promise resolves. */
  upsert(message: OutboxMessage): Promise<void>;
  delete(id: string): Promise<void>;
}

/**
 * Owner of the durable outbox.
 *
 * - Persist first, then update memory and notify: what the UI shows is never ahead of disk.
 * - Every mutation runs through one serial queue, so a send tapped during a sync pass
 *   cannot interleave with the engine's state changes.
 * - Every state change is validated against the state machine.
 */
export class Outbox {
  private cache = new Map<string, OutboxMessage>();
  private snapshot: OutboxMessage[] = [];
  private listeners = new Set<() => void>();
  private chain: Promise<void> = Promise.resolve();
  private nextSeq = 1;

  constructor(
    private readonly store: OutboxStore,
    private readonly clock: Clock,
    private readonly newId: () => string = newMessageId,
  ) {}

  /**
   * Loads durable state. Anything left in `sending` means the process died mid-request:
   * we cannot know whether the server saw it, so it goes back to `pending`. The retry
   * carries the same id, and the server dedupes it.
   */
  init(): Promise<{ restored: number; recovered: number }> {
    return this.serial(async () => {
      const rows = await this.store.loadAll();
      let recovered = 0;
      for (const row of rows) {
        let m = row;
        if (m.state === 'sending') {
          assertTransition('sending', 'pending');
          m = { ...m, state: 'pending', nextAttemptAt: null };
          await this.store.upsert(m);
          recovered++;
        }
        this.cache.set(m.id, m);
        this.nextSeq = Math.max(this.nextSeq, m.seq + 1);
      }
      this.refresh();
      return { restored: rows.length, recovered };
    });
  }

  enqueue(conversationId: string, content: string): Promise<OutboxMessage> {
    if (!content.trim()) return Promise.reject(new Error('Message is empty'));
    if (content.length > MAX_MESSAGE_LENGTH) return Promise.reject(new Error(`Message is longer than ${MAX_MESSAGE_LENGTH} characters`));
    return this.serial(async () => {
      const m: OutboxMessage = {
        id: this.newId(),
        conversationId,
        content,
        createdAt: this.clock.now(),
        seq: this.nextSeq,
        state: 'pending',
        attempts: 0,
        nextAttemptAt: null,
        lastError: null,
        serverId: null,
        deliveredAt: null,
      };
      await this.store.upsert(m);
      this.nextSeq++; // only consumed once the row is durable
      this.cache.set(m.id, m);
      this.refresh();
      return m;
    });
  }

  // --- transitions used by the sync engine and the UI -------------------------------------

  markSending(id: string): Promise<OutboxMessage> {
    return this.transition(id, 'sending', (m) => ({ attempts: m.attempts + 1, nextAttemptAt: null }));
  }

  markDelivered(id: string, serverId: string): Promise<OutboxMessage> {
    return this.transition(id, 'delivered', () => ({
      serverId,
      deliveredAt: this.clock.now(),
      lastError: null,
      nextAttemptAt: null,
    }));
  }

  /** Temporary failure with attempts left: back to pending, not before `at`. */
  scheduleRetry(id: string, error: string, at: number): Promise<OutboxMessage> {
    return this.transition(id, 'pending', () => ({ lastError: error, nextAttemptAt: at }));
  }

  /** The request died because the device went offline: don't spend a retry on it. */
  releaseWithoutPenalty(id: string, error: string): Promise<OutboxMessage> {
    return this.transition(id, 'pending', (m) => ({
      attempts: Math.max(0, m.attempts - 1),
      lastError: error,
      nextAttemptAt: null,
    }));
  }

  markFailed(id: string, error: string): Promise<OutboxMessage> {
    return this.transition(id, 'failed', () => ({ lastError: error, nextAttemptAt: null }));
  }

  /** User-initiated retry of a failed message. Resets the attempt budget. */
  retryManually(id: string): Promise<OutboxMessage> {
    return this.transition(id, 'pending', () => ({ attempts: 0, nextAttemptAt: null, lastError: null }));
  }

  /** Removes a failed message (the escape hatch under strict-fifo). */
  discard(id: string): Promise<void> {
    return this.serial(async () => {
      const cur = this.cache.get(id);
      if (!cur) throw new Error(`Unknown message ${id}`);
      if (cur.state !== 'failed') throw new Error(`Only failed messages can be discarded (state: ${cur.state})`);
      await this.store.delete(id);
      this.cache.delete(id);
      this.refresh();
    });
  }

  // --- reads -------------------------------------------------------------------------------

  /** Messages ordered by local seq. Returns a stable array until the next change. */
  list(conversationId?: string): readonly OutboxMessage[] {
    return conversationId ? this.snapshot.filter((m) => m.conversationId === conversationId) : this.snapshot;
  }

  get(id: string): OutboxMessage | undefined {
    return this.cache.get(id);
  }

  countByState(): Record<DeliveryState, number> {
    const out: Record<DeliveryState, number> = { pending: 0, sending: 0, failed: 0, delivered: 0 };
    for (const m of this.cache.values()) out[m.state]++;
    return out;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // --- internals ---------------------------------------------------------------------------

  private transition(
    id: string,
    to: DeliveryState,
    patch: (current: OutboxMessage) => Partial<OutboxMessage>,
  ): Promise<OutboxMessage> {
    return this.serial(async () => {
      const cur = this.cache.get(id);
      if (!cur) throw new Error(`Unknown message ${id}`);
      assertTransition(cur.state, to);
      const next: OutboxMessage = { ...cur, ...patch(cur), state: to };
      await this.store.upsert(next);
      this.cache.set(id, next);
      this.refresh();
      return next;
    });
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private refresh(): void {
    this.snapshot = [...this.cache.values()].sort((a, b) => a.seq - b.seq);
    for (const l of [...this.listeners]) l();
  }
}
