import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, assertTransition, InvalidTransitionError } from '../src/domain/stateMachine';
import type { DeliveryState } from '../src/domain/types';

const ALL: DeliveryState[] = ['pending', 'sending', 'failed', 'delivered'];
const VALID = new Set([
  'pending>sending',
  'sending>delivered',
  'sending>pending',
  'sending>failed',
  'failed>pending',
]);

test('exactly the documented transitions are allowed', () => {
  for (const from of ALL) {
    for (const to of ALL) {
      assert.equal(canTransition(from, to), VALID.has(`${from}>${to}`), `${from} -> ${to}`);
    }
  }
});

test('delivered is terminal and nothing skips sending', () => {
  assert.throws(() => assertTransition('delivered', 'pending'), InvalidTransitionError);
  assert.throws(() => assertTransition('pending', 'delivered'), InvalidTransitionError);
  assert.throws(() => assertTransition('failed', 'sending'), InvalidTransitionError);
});
