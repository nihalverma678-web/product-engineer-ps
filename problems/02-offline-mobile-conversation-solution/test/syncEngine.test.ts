import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TransportError, type Transport } from '../src/sync/Transport';
import {
  boot, FakeClock, InProcessTransport, ManualConnectivity, runToQuiescence, tempFile,
} from './support/harness';

async function setup(opts: { online?: boolean; config?: Parameters<typeof boot>[0]['config'] } = {}) {
  const clock = new FakeClock();
  const transport = new InProcessTransport();
  const connectivity = new ManualConnectivity(opts.online ?? false);
  const app = await boot({ file: tempFile(), clock, transport, connectivity, config: opts.config });
  return { clock, transport, connectivity, ...app };
}

test('AC3: reconnecting sends pending messages in the documented (local sequence) order', async () => {
  const { outbox, engine, transport, connectivity, clock } = await setup();
  const ids: string[] = [];
  for (let i = 1; i <= 6; i++) ids.push((await outbox.enqueue('c1', `msg ${i}`)).id);

  engine.start();
  connectivity.setOnline(true);
  await runToQuiescence(engine, clock);

  assert.deepEqual(transport.store.list().map((m) => m.clientMessageId), ids, 'server arrival order == local order');
  assert.ok(outbox.list().every((m) => m.state === 'delivered'));
  assert.ok(outbox.list().every((m) => m.serverId !== null));
});

test('AC4: a temporary failure is retried with backoff and then succeeds', async () => {
  const { outbox, engine, transport, clock } = await setup({ online: true });
  transport.faults.set({ failNext: 2 });
  const m = await outbox.enqueue('c1', 'flaky');

  await engine.trigger();
  let cur = outbox.get(m.id)!;
  assert.equal(cur.state, 'pending', 'retained, not failed and not lost');
  assert.match(cur.lastError ?? '', /503/, 'the failure is visible on the message');
  assert.equal(cur.nextAttemptAt, clock.now() + 1000, 'first backoff = base delay');
  assert.equal(transport.calls, 1, 'no hot retry loop before the backoff elapses');

  await runToQuiescence(engine, clock);
  cur = outbox.get(m.id)!;
  assert.equal(cur.state, 'delivered');
  assert.equal(cur.lastError, null);
  assert.equal(transport.calls, 3);
  assert.equal(transport.store.list().length, 1);
});

test('AC4: retries are bounded; the message becomes failed and can be retried manually', async () => {
  const { outbox, engine, transport, clock } = await setup({ online: true }); // maxAttempts = 3
  transport.faults.set({ failNext: 100 });
  const m = await outbox.enqueue('c1', 'doomed');

  await runToQuiescence(engine, clock);
  assert.equal(outbox.get(m.id)?.state, 'failed');
  assert.equal(outbox.get(m.id)?.attempts, 3);
  assert.equal(transport.calls, 3, 'exactly maxAttempts requests, then it stops');
  assert.equal(clock.hasTimers(), false, 'no further automatic retry scheduled');

  transport.faults.reset();
  await outbox.retryManually(m.id);
  assert.equal(outbox.get(m.id)?.attempts, 0, 'manual retry resets the attempt budget');
  await runToQuiescence(engine, clock);
  assert.equal(outbox.get(m.id)?.state, 'delivered');
  assert.equal(transport.store.list().length, 1);
});

test('a permanent rejection is not retried automatically, but can be retried manually', async () => {
  const { outbox, engine, transport, clock } = await setup({ online: true });
  transport.faults.set({ rejectNext: 1 });
  const m = await outbox.enqueue('c1', 'rejected once');

  await runToQuiescence(engine, clock);
  assert.equal(outbox.get(m.id)?.state, 'failed');
  assert.equal(transport.calls, 1);

  await outbox.retryManually(m.id);
  await runToQuiescence(engine, clock);
  assert.equal(outbox.get(m.id)?.state, 'delivered');
});

test('AC5: a lost acknowledgement is retried with the same id and yields exactly one server message', async () => {
  const { outbox, engine, transport, clock } = await setup({ online: true });
  transport.faults.set({ dropAckNext: 1 });
  const m = await outbox.enqueue('c1', 'did you get this?');

  await engine.trigger();
  assert.equal(transport.store.list().length, 1, 'the server stored it even though the client heard nothing');
  assert.equal(outbox.get(m.id)?.state, 'pending', 'the client must not claim delivery');

  await runToQuiescence(engine, clock);
  assert.equal(transport.calls, 2);
  assert.equal(transport.duplicateAcks, 1, 'the retry was recognised as a duplicate');
  assert.equal(transport.store.list().length, 1, 'still one logical message');
  assert.equal(outbox.get(m.id)?.state, 'delivered');
  assert.equal(outbox.get(m.id)?.serverId, transport.store.list()[0].serverId);
});

test('recovery after a crash mid-request: the interrupted message is re-sent without duplicating', async () => {
  const file = tempFile();
  const clock = new FakeClock();
  const transport = new InProcessTransport();
  const connectivity = new ManualConnectivity(true);

  const first = await boot({ file, clock, transport, connectivity });
  const m = await first.outbox.enqueue('c1', 'in flight when the app died');
  await first.outbox.markSending(m.id);
  transport.store.accept({ // the server got it; the app died before hearing back
    clientMessageId: m.id, conversationId: 'c1', content: m.content, clientSeq: m.seq, clientCreatedAt: m.createdAt,
  });

  const second = await boot({ file, clock, transport, connectivity });
  await runToQuiescence(second.engine, clock);

  assert.equal(second.outbox.get(m.id)?.state, 'delivered');
  assert.equal(transport.store.list().length, 1);
});

test('going offline mid-request does not spend the message\'s retry budget', async () => {
  const clock = new FakeClock();
  const connectivity = new ManualConnectivity(true);
  const dropping: Transport = {
    async send() {
      connectivity.setOnline(false); // the lift doors close mid-request
      throw new TransportError('network', 'Network request failed');
    },
  };
  const { outbox, engine } = await boot({ file: tempFile(), clock, transport: dropping, connectivity });
  const m = await outbox.enqueue('c1', 'hi');

  await engine.trigger();

  assert.equal(outbox.get(m.id)?.state, 'pending');
  assert.equal(outbox.get(m.id)?.attempts, 0);
  assert.equal(clock.hasTimers(), false, 'no backoff timer: it waits for connectivity instead');
});

test('strict-fifo: a failed message blocks later ones until the user acts', async () => {
  const { outbox, engine, transport, clock } = await setup({ online: true });
  transport.faults.set({ rejectNext: 1 });
  const a = await outbox.enqueue('c1', 'poisoned');
  const b = await outbox.enqueue('c1', 'behind it');

  await runToQuiescence(engine, clock);
  assert.equal(outbox.get(a.id)?.state, 'failed');
  assert.equal(outbox.get(b.id)?.state, 'pending', 'held back to preserve order');
  assert.equal(transport.store.list().length, 0);

  await outbox.retryManually(a.id);
  await runToQuiescence(engine, clock);
  assert.deepEqual(transport.store.list().map((m) => m.clientMessageId), [a.id, b.id]);
});

test('skip-failed: a failed message does not block later ones', async () => {
  const { outbox, engine, transport, clock } = await setup({ online: true, config: { policy: 'skip-failed' } });
  transport.faults.set({ rejectNext: 1 });
  const a = await outbox.enqueue('c1', 'poisoned');
  const b = await outbox.enqueue('c1', 'goes through');

  await runToQuiescence(engine, clock);
  assert.equal(outbox.get(a.id)?.state, 'failed');
  assert.equal(outbox.get(b.id)?.state, 'delivered');
  assert.equal(transport.store.list()[0].clientSeq, outbox.get(b.id)?.seq, 'server carries clientSeq for reordering');
});

test('concurrency: overlapping triggers and sends never send a message twice', async () => {
  const { outbox, engine, transport, connectivity, clock } = await setup();
  for (let i = 0; i < 5; i++) await outbox.enqueue('c1', `m${i}`);

  connectivity.setOnline(true);
  const passes = [engine.trigger(), engine.trigger(), engine.trigger()];
  await outbox.enqueue('c1', 'added mid-sync'); // arrives while a pass is running
  passes.push(engine.trigger(), engine.trigger());
  await Promise.all(passes);
  await runToQuiescence(engine, clock);

  assert.equal(transport.calls, 6, 'one request per message');
  assert.equal(transport.store.list().length, 6);
  assert.ok(outbox.list().every((m) => m.state === 'delivered'));
});
