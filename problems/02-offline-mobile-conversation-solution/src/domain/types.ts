/**
 * Delivery states (see stateMachine.ts for the allowed transitions).
 *  pending   – stored locally, waiting for a connection or for its next retry time
 *  sending   – a request is in flight right now
 *  failed    – automatic retries exhausted or permanently rejected; user action needed
 *  delivered – the server acknowledged it
 */
export type DeliveryState = 'pending' | 'sending' | 'failed' | 'delivered';

export interface OutboxMessage {
  /** Stable client-generated id. Doubles as the idempotency key on the server. */
  id: string;
  conversationId: string;
  content: string;
  /** Wall-clock creation time (display only; never used for ordering). */
  createdAt: number;
  /** Local monotonic sequence number. The single source of truth for send order. */
  seq: number;
  state: DeliveryState;
  /** Attempts started so far (incremented when a request begins). */
  attempts: number;
  /** Earliest time the next automatic attempt may start; null = immediately. */
  nextAttemptAt: number | null;
  lastError: string | null;
  serverId: string | null;
  deliveredAt: number | null;
}
