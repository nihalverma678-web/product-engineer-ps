import type { OutboxMessage } from '../domain/types';

/** Honest, user-facing wording for each delivery state. Pure, so it is unit-tested. */
export function statusLabel(m: OutboxMessage, online: boolean, maxAttempts: number): string {
  switch (m.state) {
    case 'pending':
      if (m.lastError) return `Couldn't send (${m.lastError}). Will retry. Attempt ${m.attempts} of ${maxAttempts} used.`;
      return online ? 'Waiting to send' : 'Waiting for connection';
    case 'sending':
      return m.attempts > 1 ? `Sending, attempt ${m.attempts} of ${maxAttempts}` : 'Sending';
    case 'failed':
      return `Not sent: ${m.lastError ?? 'unknown error'}`;
    case 'delivered':
      return 'Delivered';
  }
}
