import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { MessageStore, IdempotencyConflictError } from '../server/MessageStore';
import { createHttpServer } from '../server/httpServer';
import { HttpTransport } from '../src/sync/HttpTransport';
import { TransportError, type SendRequest } from '../src/sync/Transport';

const req = (over: Partial<SendRequest> = {}): SendRequest => ({
  clientMessageId: 'a', conversationId: 'c1', content: 'hi', clientSeq: 1, clientCreatedAt: 1, ...over,
});

test('server: the same clientMessageId is stored once, however often it is sent', () => {
  const store = new MessageStore();
  const first = store.accept(req());
  const again = store.accept(req());
  store.accept(req());
  assert.equal(first.duplicate, false);
  assert.equal(again.duplicate, true);
  assert.equal(again.message.serverId, first.message.serverId);
  assert.equal(store.list().length, 1);
});

test('server: reusing an id with a different payload is a conflict, not a silent overwrite', () => {
  const store = new MessageStore();
  store.accept(req());
  assert.throws(() => store.accept(req({ content: 'different' })), IdempotencyConflictError);
});

test('HTTP: a dropped acknowledgement surfaces as a network error and the retry is deduplicated', async () => {
  const { server, store, faults } = createHttpServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const transport = new HttpTransport(`http://127.0.0.1:${port}`, 2000);
  try {
    faults.set({ dropAckNext: 1 });
    await assert.rejects(
      () => transport.send(req()),
      (e: unknown) => e instanceof TransportError && e.kind === 'network',
    );
    assert.equal(store.list().length, 1, 'stored despite the lost ack');

    const ack = await transport.send(req());
    assert.equal(ack.duplicate, true);
    assert.equal(store.list().length, 1);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});

test('HTTP: 503 is temporary, 422 is permanent, slow responses time out', async () => {
  const { server, faults } = createHttpServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const transport = new HttpTransport(`http://127.0.0.1:${port}`, 200);
  const kindOf = async (r: SendRequest) => {
    try { await transport.send(r); return 'ok'; } catch (e) { return (e as TransportError).kind; }
  };
  try {
    faults.set({ failNext: 1 });
    assert.equal(await kindOf(req({ clientMessageId: 'x1' })), 'temporary');
    faults.set({ rejectNext: 1 });
    assert.equal(await kindOf(req({ clientMessageId: 'x2' })), 'permanent');
    faults.set({ latencyMs: 600 });
    assert.equal(await kindOf(req({ clientMessageId: 'x3' })), 'timeout');
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
