import type { OutboxMessage } from './types';

/**
 * Ordering policy
 * ---------------
 * Messages are sent one at a time, per conversation, in local `seq` order.
 *
 *  strict-fifo (default): nothing behind an unresolved message may be sent. A `failed`
 *    message blocks the messages after it until the user retries or discards it.
 *    Pro: the server always sees the conversation in the order the user typed it.
 *    Con: one poisoned message stalls the queue until the user acts.
 *
 *  skip-failed: a `failed` message no longer blocks later ones. A message that is merely
 *    waiting for its next automatic retry still blocks (a temporary failure usually
 *    affects everything behind it). Pro: no permanent head-of-line blocking.
 *    Con: the server can receive a manually retried message after later ones, so
 *    clients must order by `clientSeq`, not by arrival.
 */
export type OrderingPolicy = 'strict-fifo' | 'skip-failed';

export type Selection =
  | { kind: 'send'; message: OutboxMessage }
  | { kind: 'wait'; until: number }
  | { kind: 'idle' };

export function selectNext(
  messages: readonly OutboxMessage[],
  now: number,
  policy: OrderingPolicy,
): Selection {
  const byConversation = new Map<string, OutboxMessage[]>();
  for (const m of messages) {
    if (m.state === 'delivered') continue;
    const list = byConversation.get(m.conversationId) ?? [];
    list.push(m);
    byConversation.set(m.conversationId, list);
  }

  let best: OutboxMessage | null = null;
  let earliestWake: number | null = null;

  for (const list of byConversation.values()) {
    list.sort((a, b) => a.seq - b.seq);
    for (const m of list) {
      if (m.state === 'sending') break; // a request is in flight; wait for its outcome
      if (m.state === 'failed') {
        if (policy === 'strict-fifo') break;
        continue;
      }
      // pending
      if (m.nextAttemptAt !== null && m.nextAttemptAt > now) {
        earliestWake = earliestWake === null ? m.nextAttemptAt : Math.min(earliestWake, m.nextAttemptAt);
        break; // backing off: keep order, wait for it
      }
      if (best === null || m.seq < best.seq) best = m;
      break;
    }
  }

  if (best) return { kind: 'send', message: best };
  if (earliestWake !== null) return { kind: 'wait', until: earliestWake };
  return { kind: 'idle' };
}
