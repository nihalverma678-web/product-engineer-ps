import { MAX_MESSAGE_LENGTH } from '../src/domain/limits';
import type { SendRequest } from '../src/sync/Transport';
import type { FaultPlan } from './FaultPlan';
import { IdempotencyConflictError, type MessageStore } from './MessageStore';

export interface SendResult {
  status: number;
  body: Record<string, unknown>;
  /** The message was stored, but the response must never reach the client. */
  dropAck: boolean;
}

/**
 * The whole "send message" endpoint as a pure function, shared by the HTTP server and the
 * in-process test transport so both behave identically.
 */
export function processSend(
  store: MessageStore,
  faults: FaultPlan,
  conversationId: string,
  raw: unknown,
): SendResult {
  const req = raw as Partial<SendRequest> | null;
  if (
    !req ||
    typeof req.clientMessageId !== 'string' || !req.clientMessageId ||
    typeof req.content !== 'string' || !req.content.trim() || req.content.length > MAX_MESSAGE_LENGTH ||
    typeof req.clientSeq !== 'number' ||
    typeof req.clientCreatedAt !== 'number' ||
    req.conversationId !== conversationId
  ) {
    return { status: 400, body: { error: 'Invalid message' }, dropAck: false };
  }

  if (faults.consume('rejectNext')) {
    return { status: 422, body: { error: 'Rejected (fault injection)' }, dropAck: false };
  }
  if (faults.consume('failNext')) {
    return { status: 503, body: { error: 'Temporarily unavailable (fault injection)' }, dropAck: false };
  }

  try {
    const { message, duplicate } = store.accept(req as SendRequest);
    return {
      status: duplicate ? 200 : 201,
      body: { serverId: message.serverId, duplicate },
      dropAck: faults.consume('dropAckNext'),
    };
  } catch (e) {
    if (e instanceof IdempotencyConflictError) {
      return { status: 409, body: { error: e.message }, dropAck: false };
    }
    throw e;
  }
}
