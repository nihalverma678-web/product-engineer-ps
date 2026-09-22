import { FaultPlan } from '../../server/FaultPlan';
import { MessageStore } from '../../server/MessageStore';
import { processSend } from '../../server/processSend';
import {
  classifyStatus,
  TransportError,
  type SendAck,
  type SendRequest,
  type Transport,
} from '../../src/sync/Transport';

/** Talks to the mock backend's logic directly (no sockets), mapping results like HttpTransport. */
export class InProcessTransport implements Transport {
  calls = 0;
  duplicateAcks = 0;
  constructor(
    public readonly store = new MessageStore(),
    public readonly faults = new FaultPlan(),
  ) {}

  async send(req: SendRequest): Promise<SendAck> {
    this.calls++;
    const r = processSend(this.store, this.faults, req.conversationId, req);
    if (r.status >= 200 && r.status < 300) {
      if (r.dropAck) throw new TransportError('network', 'Connection lost before acknowledgement');
      const ack = r.body as { serverId: string; duplicate: boolean };
      if (ack.duplicate) this.duplicateAcks++;
      return ack;
    }
    throw new TransportError(classifyStatus(r.status), `HTTP ${r.status}`, r.status);
  }
}
