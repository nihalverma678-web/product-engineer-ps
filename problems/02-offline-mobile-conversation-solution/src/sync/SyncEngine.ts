import { backoffDelay, type RetryConfig } from '../domain/backoff';
import { selectNext, type OrderingPolicy } from '../domain/ordering';
import type { OutboxMessage } from '../domain/types';
import type { Outbox } from '../outbox/Outbox';
import type { Clock } from './Clock';
import type { Connectivity } from './Connectivity';
import { isRetryable, toTransportError, type Transport } from './Transport';

export interface SyncConfig {
  retry: RetryConfig;
  policy: OrderingPolicy;
}

export interface SyncDeps {
  outbox: Outbox;
  transport: Transport;
  connectivity: Connectivity;
  clock: Clock;
  config: SyncConfig;
  onError?: (e: unknown) => void;
}

/**
 * Drains the outbox. Knows nothing about screens, SQLite, or HTTP: those arrive as
 * injected dependencies, so the whole thing runs under test with fakes.
 *
 * Concurrency: `trigger()` is single-flight. Calls made while a pass is running set a
 * flag that makes the running pass loop once more, so nothing enqueued mid-sync is missed
 * and no two passes ever send concurrently.
 */
export class SyncEngine {
  private running: Promise<void> | null = null;
  private rerun = false;
  private cancelWake: (() => void) | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly d: SyncDeps) {}

  /** Begin reacting to connectivity changes, and run one pass now. */
  start(): void {
    this.unsubscribe = this.d.connectivity.subscribe((online) => {
      if (online) void this.trigger();
    });
    void this.trigger();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.clearWake();
  }

  /** Request a sync pass. Resolves when the pass (and any pass it queued) finishes. */
  trigger(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.rerun = false;
          await this.drain();
        } while (this.rerun);
      } catch (e) {
        this.d.onError?.(e);
      } finally {
        this.running = null; // cleared synchronously with the loop check: no lost wake-ups
      }
    })();
    return this.running;
  }

  /** Resolves when no pass is running. */
  idle(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  private async drain(): Promise<void> {
    this.clearWake();
    const { outbox, connectivity, clock, config } = this.d;
    while (connectivity.isOnline()) {
      const next = selectNext(outbox.list(), clock.now(), config.policy);
      if (next.kind === 'idle') return;
      if (next.kind === 'wait') {
        this.scheduleWake(next.until);
        return;
      }
      await this.sendOne(next.message);
    }
  }

  private async sendOne(msg: OutboxMessage): Promise<void> {
    const { outbox, transport, connectivity, clock, config } = this.d;
    const started = await outbox.markSending(msg.id); // durable before the request leaves

    let serverId: string;
    try {
      const ack = await transport.send({
        clientMessageId: started.id,
        conversationId: started.conversationId,
        content: started.content,
        clientSeq: started.seq,
        clientCreatedAt: started.createdAt,
      });
      serverId = ack.serverId;
    } catch (e) {
      const err = toTransportError(e);
      if (err.kind === 'network' && !connectivity.isOnline()) {
        await outbox.releaseWithoutPenalty(started.id, 'Offline');
      } else if (!isRetryable(err.kind) || started.attempts >= config.retry.maxAttempts) {
        await outbox.markFailed(started.id, err.message);
      } else {
        const at = clock.now() + backoffDelay(started.attempts, config.retry);
        await outbox.scheduleRetry(started.id, err.message, at);
      }
      return;
    }
    await outbox.markDelivered(started.id, serverId);
  }

  private scheduleWake(until: number): void {
    const delay = Math.max(0, until - this.d.clock.now());
    this.cancelWake = this.d.clock.setTimeout(() => {
      this.cancelWake = null;
      void this.trigger();
    }, delay);
  }

  private clearWake(): void {
    this.cancelWake?.();
    this.cancelWake = null;
  }
}
