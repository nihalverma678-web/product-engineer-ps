import type { OutboxMessage } from '../domain/types';
import type { Outbox } from '../outbox/Outbox';
import type { SyncEngine } from '../sync/SyncEngine';

/**
 * What the screen is allowed to do. The UI never touches storage or the network: it asks
 * this facade, and reads state back from the outbox.
 */
export class ConversationService {
  constructor(
    private readonly outbox: Outbox,
    private readonly engine: SyncEngine,
    readonly conversationId: string,
  ) {}

  /** Resolves once the message is durable (and therefore visible), not once it is delivered. */
  async send(content: string): Promise<OutboxMessage> {
    const message = await this.outbox.enqueue(this.conversationId, content);
    void this.engine.trigger();
    return message;
  }

  async retry(id: string): Promise<void> {
    await this.outbox.retryManually(id);
    void this.engine.trigger();
  }

  async discard(id: string): Promise<void> {
    await this.outbox.discard(id);
    void this.engine.trigger(); // under strict-fifo, this may unblock later messages
  }
}
