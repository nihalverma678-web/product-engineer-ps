/**
 * Verification benchmark:  npm run benchmark
 *
 *  1. Queue 12 messages while offline.
 *  2. "Restart" the app (fresh Outbox + engine on the same durable file) before syncing.
 *  3. Inject one temporary failure (503) and one lost acknowledgement.
 *  4. Restore connectivity and let synchronization finish.
 *  5. Check every logical message exists exactly once on the backend, in the documented order.
 *
 * Real HTTP server, real HttpTransport, real timers (short backoff). Exit code 0 = pass.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createHttpServer } from '../server/httpServer';
import { Outbox } from '../src/outbox/Outbox';
import { ManualConnectivity } from '../src/sync/Connectivity';
import { systemClock } from '../src/sync/Clock';
import { HttpTransport } from '../src/sync/HttpTransport';
import type { SendAck, SendRequest, Transport } from '../src/sync/Transport';
import { SyncEngine } from '../src/sync/SyncEngine';
import { FileOutboxStore } from '../test/support/FileOutboxStore';

const COUNT = 12;
const CONVERSATION = 'bench';
const ACK_LOST_AT_SEQ = 6;

const failures: string[] = [];
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${label}`);
  if (!ok) failures.push(label);
};

async function main() {
  const { server, store, faults } = createHttpServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bench-')), 'outbox.json');

  // Wraps the real HTTP transport to (a) arm a lost ack mid-run, (b) count what happened.
  const stats = { requests: 0, duplicateAcks: 0, networkErrors: 0, temporaryErrors: 0 };
  let ackLostArmed = false;
  const http = new HttpTransport(baseUrl, 2000);
  const transport: Transport = {
    async send(req: SendRequest): Promise<SendAck> {
      stats.requests++;
      if (req.clientSeq === ACK_LOST_AT_SEQ && !ackLostArmed) {
        ackLostArmed = true;
        faults.set({ dropAckNext: 1 });
      }
      try {
        const ack = await http.send(req);
        if (ack.duplicate) stats.duplicateAcks++;
        return ack;
      } catch (e) {
        const kind = (e as { kind?: string }).kind;
        if (kind === 'network') stats.networkErrors++;
        if (kind === 'temporary') stats.temporaryErrors++;
        throw e;
      }
    },
  };
  const config = { retry: { maxAttempts: 5, baseDelayMs: 40, maxDelayMs: 200 }, policy: 'strict-fifo' as const };

  console.log(`\n[1] Offline: queueing ${COUNT} messages`);
  const connectivity = new ManualConnectivity(false);
  const before = new Outbox(new FileOutboxStore(file), systemClock);
  await before.init();
  const sent: string[] = [];
  for (let i = 1; i <= COUNT; i++) sent.push((await before.enqueue(CONVERSATION, `message ${i}`)).id);
  check(before.list().every((m) => m.state === 'pending'), `all ${COUNT} are pending, none delivered`);
  check(store.list().length === 0, 'backend has 0 messages');

  console.log('\n[2] Restart before synchronization');
  const outbox = new Outbox(new FileOutboxStore(file), systemClock); // brand-new objects, same file
  const { restored } = await outbox.init();
  check(restored === COUNT, `restored ${restored}/${COUNT} messages from durable storage`);
  check(JSON.stringify(outbox.list().map((m) => m.id)) === JSON.stringify(sent), 'same ids in the same order');

  console.log('\n[3] Fault injection: one 503, one lost acknowledgement (armed at message 6)');
  faults.set({ failNext: 1 });

  console.log('\n[4] Connectivity restored: synchronizing');
  const engine = new SyncEngine({
    outbox, transport, connectivity, clock: systemClock, config,
    onError: (e) => failures.push(`engine error: ${String(e)}`),
  });
  engine.start();
  connectivity.setOnline(true);
  const deadline = Date.now() + 15_000;
  while (outbox.list().some((m) => m.state !== 'delivered') && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
  }
  engine.stop();

  console.log('\n[5] Verification');
  const onServer = store.list(CONVERSATION);
  const serverIds = onServer.map((m) => m.clientMessageId);
  check(outbox.list().every((m) => m.state === 'delivered'), 'every message is delivered on the client');
  check(onServer.length === COUNT, `backend holds exactly ${COUNT} messages (found ${onServer.length})`);
  check(new Set(serverIds).size === COUNT, 'no duplicate logical messages');
  check(JSON.stringify(serverIds) === JSON.stringify(sent), 'backend arrival order matches the documented order');
  check(stats.temporaryErrors >= 1, `a temporary failure occurred (${stats.temporaryErrors})`);
  check(stats.networkErrors >= 1 && stats.duplicateAcks >= 1,
    `a lost ack occurred and its retry was deduplicated (network errors: ${stats.networkErrors}, duplicate acks: ${stats.duplicateAcks})`);
  console.log(`\n  requests sent: ${stats.requests} for ${COUNT} messages`);

  server.closeAllConnections();
  await new Promise((r) => server.close(r));

  if (failures.length) {
    console.log(`\nFAIL (${failures.length})`);
    process.exit(1);
  }
  console.log('\nPASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
