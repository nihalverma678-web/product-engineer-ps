import type { DeliveryState } from './types';

/**
 * Allowed delivery-state transitions.
 *
 *   pending ──▶ sending ──▶ delivered
 *      ▲           │
 *      │           ├──▶ pending   (temporary failure with attempts left, going offline
 *      │           │               mid-request, or crash recovery on startup)
 *      │           └──▶ failed    (retries exhausted or permanent rejection)
 *      └───────── failed          (manual retry)
 *
 * `delivered` is terminal. Nothing may skip `sending`.
 */
const ALLOWED: Record<DeliveryState, readonly DeliveryState[]> = {
  pending: ['sending'],
  sending: ['delivered', 'pending', 'failed'],
  failed: ['pending'],
  delivered: [],
};

export function canTransition(from: DeliveryState, to: DeliveryState): boolean {
  return ALLOWED[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(public readonly from: DeliveryState, public readonly to: DeliveryState) {
    super(`Invalid delivery-state transition: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function assertTransition(from: DeliveryState, to: DeliveryState): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}
