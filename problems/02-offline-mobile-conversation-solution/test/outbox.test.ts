import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boot, FakeClock, InProcessTransport, ManualConnectivity, tempFile } from './support/harness';

test('AC1: an offline send is stored locally as pending, not lost and not delivered', async () => {
  const file = tempFile();
  const transport = new InProcessTransport();
  const { outbox, engine } = await boot({
    file, clock: new FakeClock(), transport, connectivity: new ManualConnectivity(false),
  });

  const m = await outbox.enqueue('c1', 'hello from a lift');
  await engine.trigger();

  assert.equal(outbox.get(m.id)?.state, 'pending');
  assert.equal(transport.calls, 0, 'no request may be attempted while offline');
  assert.equal(transport.store.list().length, 0);
});

test('AC2: pending messages and their states survive an app restart', async () => {
  const file = tempFile();
  const clock = new FakeClock();
  const transport = new InProcessTransport();
  const connectivity = new ManualConnectivity(false);

  const first = await boot({ file, clock, transport, connectivity });
  const a = await first.outbox.enqueue('c1', 'one');   // stays pending
  const b = await first.outbox.enqueue('c1', 'two');   // in flight when the app dies
  const c = await first.outbox.enqueue('c1', 'three'); // already failed
  await first.outbox.markSending(b.id);
  await first.outbox.markSending(c.id);
  await first.outbox.markFailed(c.id, 'HTTP 422');

  // App is killed here. A new process opens the same file.
  const second = await boot({ file, clock, transport, connectivity });

  assert.deepEqual(second.outbox.list().map((m) => m.id), [a.id, b.id, c.id], 'same messages, same order');
  assert.equal(second.init.restored, 3);
  assert.equal(second.init.recovered, 1, 'the in-flight message is recovered');
  assert.equal(second.outbox.get(a.id)?.state, 'pending');
  assert.equal(second.outbox.get(b.id)?.state, 'pending', 'sending -> pending after a crash');
  assert.equal(second.outbox.get(c.id)?.state, 'failed', 'failed stays failed (and visible)');
  assert.equal(second.outbox.get(c.id)?.lastError, 'HTTP 422');
  assert.equal(second.outbox.get(a.id)?.content, 'one');
});

test('sequence numbers keep increasing across restarts (no reused ordering value)', async () => {
  const file = tempFile();
  const clock = new FakeClock();
  const transport = new InProcessTransport();
  const connectivity = new ManualConnectivity(false);

  const first = await boot({ file, clock, transport, connectivity });
  await first.outbox.enqueue('c1', 'one');
  const second = await boot({ file, clock, transport, connectivity, newId: () => 'later' });
  const m = await second.outbox.enqueue('c1', 'two');
  assert.equal(m.seq, 2);
});

test('invalid messages (blank or too long) are rejected before they reach the outbox', async () => {
  const { outbox } = await boot({
    file: tempFile(), clock: new FakeClock(), transport: new InProcessTransport(),
    connectivity: new ManualConnectivity(false),
  });
  await assert.rejects(() => outbox.enqueue('c1', '   '), /empty/i);
  await assert.rejects(() => outbox.enqueue('c1', 'x'.repeat(4001)), /longer than/i);
  assert.equal(outbox.list().length, 0);
});

test('only failed messages can be discarded', async () => {
  const { outbox } = await boot({
    file: tempFile(), clock: new FakeClock(), transport: new InProcessTransport(),
    connectivity: new ManualConnectivity(false),
  });
  const m = await outbox.enqueue('c1', 'x');
  await assert.rejects(() => outbox.discard(m.id), /failed/);
  await outbox.markSending(m.id);
  await outbox.markFailed(m.id, 'nope');
  await outbox.discard(m.id);
  assert.equal(outbox.list().length, 0);
});
