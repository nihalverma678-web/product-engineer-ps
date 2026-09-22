export interface SendRequest {
  /** Idempotency key: the server stores at most one message per clientMessageId. */
  clientMessageId: string;
  conversationId: string;
  content: string;
  /** Local ordering value. Lets the server (or a reader) reconstruct the user's order. */
  clientSeq: number;
  clientCreatedAt: number;
}

export interface SendAck {
  serverId: string;
  /** True when the server had already stored this clientMessageId (a retry after a lost ack). */
  duplicate: boolean;
}

/**
 * network   – no response (offline, DNS, connection reset). Includes the "ack lost" case.
 * timeout   – no response within the client's deadline. Outcome unknown.
 * temporary – server said try later (408, 429, 5xx).
 * permanent – server rejected the message (other 4xx). Retrying unchanged cannot succeed.
 *
 * network, timeout and temporary are retried automatically; permanent is not.
 */
export type TransportErrorKind = 'network' | 'timeout' | 'temporary' | 'permanent';

export class TransportError extends Error {
  constructor(public readonly kind: TransportErrorKind, message: string, public readonly status?: number) {
    super(message);
    this.name = 'TransportError';
  }
}

export function isRetryable(kind: TransportErrorKind): boolean {
  return kind !== 'permanent';
}

export function classifyStatus(status: number): TransportErrorKind {
  if (status === 408 || status === 429 || status >= 500) return 'temporary';
  return 'permanent';
}

export function toTransportError(e: unknown): TransportError {
  if (e instanceof TransportError) return e;
  return new TransportError('network', e instanceof Error ? e.message : String(e));
}

export interface Transport {
  send(req: SendRequest): Promise<SendAck>;
}
