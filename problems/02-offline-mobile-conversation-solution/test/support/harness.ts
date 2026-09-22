import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Outbox } from '../../src/outbox/Outbox';
import { SyncEngine, type SyncConfig } from '../../src/sync/SyncEngine';
import { ManualConnectivity } from '../../src/sync/Connectivity';
import type { Transport } from '../../src/sync/Transport';
import { FakeClock } from './FakeClock';
import { FileOutboxStore } from './FileOutboxStore';
import { InProcessTransport } from './InProcessTransport';

export const TEST_CONFIG: SyncConfig = {
  retry: { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 8000 },
  policy: 'strict-fifo',
};

export function tempFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outbox-'));
  return path.join(dir, 'outbox.json');
}

/** Deterministic ids: m1, m2, ... */
export function counterIds(prefix = 'm'): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}

/** Everything one "app launch" consists of. Call boot() twice on one file to simulate a restart. */
export async function boot(opts: {
  file: string;
  clock: FakeClock;
  transport: Transport;
  connectivity: ManualConnectivity;
  config?: Partial<SyncConfig>;
  newId?: () => string;
}) {
  const outbox = new Outbox(new FileOutboxStore(opts.file), opts.clock, opts.newId ?? counterIds());
  const init = await outbox.init();
  const engine = new SyncEngine({
    outbox,
    transport: opts.transport,
    connectivity: opts.connectivity,
    clock: opts.clock,
    config: { ...TEST_CONFIG, ...opts.config },
    onError: (e) => {
      throw e;
    },
  });
  return { outbox, engine, init };
}

/** Run the engine, firing backoff timers, until nothing is left to do. */
export async function runToQuiescence(engine: SyncEngine, clock: FakeClock): Promise<void> {
  await engine.trigger();
  let guard = 0;
  while (clock.hasTimers()) {
    if (++guard > 100) throw new Error('runToQuiescence: too many timer hops');
    clock.advanceToNext();
    await engine.idle();
  }
}

export { InProcessTransport, FakeClock, ManualConnectivity };
