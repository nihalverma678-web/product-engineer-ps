import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusLabel } from '../src/ui/statusLabel';
import type { OutboxMessage } from '../src/domain/types';

const base: OutboxMessage = {
  id: 'a', conversationId: 'c', content: 'x', createdAt: 0, seq: 1, state: 'pending',
  attempts: 0, nextAttemptAt: null, lastError: null, serverId: null, deliveredAt: null,
};

test('offline pending messages are labelled honestly, never as sent', () => {
  assert.equal(statusLabel(base, false, 5), 'Waiting for connection');
  assert.equal(statusLabel(base, true, 5), 'Waiting to send');
});

test('every state has distinct, truthful wording', () => {
  assert.match(statusLabel({ ...base, state: 'sending', attempts: 2 }, true, 5), /attempt 2 of 5/);
  assert.match(statusLabel({ ...base, state: 'pending', attempts: 1, lastError: 'HTTP 503' }, true, 5), /Will retry/);
  assert.match(statusLabel({ ...base, state: 'failed', lastError: 'HTTP 422' }, true, 5), /Not sent: HTTP 422/);
  assert.equal(statusLabel({ ...base, state: 'delivered' }, true, 5), 'Delivered');
});
