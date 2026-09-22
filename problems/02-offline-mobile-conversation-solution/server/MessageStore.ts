import type { SendRequest } from '../src/sync/Transport';

export interface StoredMessage {
  serverId: string;
  clientMessageId: string;
  conversationId: string;
  content: string;
  clientSeq: number;
  clientCreatedAt: number;
  receivedAt: number;
  /** Position in server arrival order (for verifying the benchmark). */
  arrival: number;
}

export class IdempotencyConflictError extends Error {
  constructor(id: string) {
    super(`clientMessageId ${id} was already used with a different payload`);
    this.name = 'IdempotencyConflictError';
  }
}

/**
 * In-memory message log. Idempotency is enforced here, on the server, by a unique key on
 * clientMessageId: the client can retry as often as it likes and the log gets one row.
 * (In a real database: a UNIQUE constraint plus INSERT ... ON CONFLICT DO NOTHING.)
 */
export class MessageStore {
  private byClientId = new Map<string, StoredMessage>();
  private log: StoredMessage[] = [];

  accept(req: SendRequest): { message: StoredMessage; duplicate: boolean } {
    const existing = this.byClientId.get(req.clientMessageId);
    if (existing) {
      if (existing.content !== req.content || existing.conversationId !== req.conversationId) {
        throw new IdempotencyConflictError(req.clientMessageId);
      }
      return { message: existing, duplicate: true };
    }
    const message: StoredMessage = {
      serverId: `srv_${this.log.length + 1}`,
      clientMessageId: req.clientMessageId,
      conversationId: req.conversationId,
      content: req.content,
      clientSeq: req.clientSeq,
      clientCreatedAt: req.clientCreatedAt,
      receivedAt: Date.now(),
      arrival: this.log.length + 1,
    };
    this.byClientId.set(message.clientMessageId, message);
    this.log.push(message);
    return { message, duplicate: false };
  }

  /** Messages in server arrival order. */
  list(conversationId?: string): StoredMessage[] {
    return this.log.filter((m) => !conversationId || m.conversationId === conversationId);
  }

  clear(): void {
    this.byClientId.clear();
    this.log = [];
  }
}
