# Offline-capable conversation (React Native / Expo)

A minimal chat screen whose outgoing messages are saved on the device first and then synchronized safely: nothing is lost offline, nothing is duplicated on retry, and the order is predictable.

## Run it

```bash
npm install
npx expo install --fix          # aligns expo-sqlite / netinfo / react-native with your Expo SDK

npm run server                  # terminal 1: mock backend on :4000
npm start                       # terminal 2: Expo (press i / a, or scan the QR in Expo Go)

npm test                        # 23 tests, no device or network needed
npm run benchmark               # end-to-end verification (see below)
```

Backend URL: iOS simulator uses `localhost:4000`, the Android emulator uses `10.0.2.2:4000` (both automatic). On a physical device, start Expo with `EXPO_PUBLIC_API_URL=http://<your-computer's-LAN-IP>:4000`.

> `expo-sqlite` needs a native module, so it runs in Expo Go or a dev build, not in the web target.

## Architecture

```
 ChatScreen / DebugPanel          UI: renders state, calls ConversationService. No storage, no network.
        │  reads                     │ send / retry / discard
        ▼                            ▼
 ┌──────────────────────────────────────────────┐
 │ Outbox  (durable state owner)                │  validates transitions, persist-first, serial queue
 │   └─ OutboxStore ── SqliteOutboxStore (app)  │
 │                  └─ FileOutboxStore (tests)  │
 └──────────────────────────────────────────────┘
        ▲ markSending / markDelivered / scheduleRetry / markFailed
        │
 SyncEngine  ── Clock, Connectivity, Transport (all injected)
        │                 │             └─ HttpTransport ─▶ mock backend (idempotent on clientMessageId)
        │                 └─ NetInfoConnectivity + "simulate offline" override
        └─ selectNext(): the ordering policy, as a pure function
```

| Layer | Files | Owns |
|---|---|---|
| Screen state | `src/ui`, `src/app/useMessages.ts` | Nothing durable. A read-only mirror of the outbox. |
| Durable outbox | `src/outbox` | Message rows, delivery state, local sequence numbers. |
| Synchronization | `src/sync`, `src/domain` | When to send, in what order, retry and backoff. |
| Backend | `server/` | Idempotency, fault injection. |

## Message contract

Each `OutboxMessage` has: `id` (client-generated UUID, also the idempotency key), `conversationId`, `content`, `createdAt` (display only), `seq` (local monotonic ordering value), `state` (`pending | sending | failed | delivered`), plus `attempts`, `nextAttemptAt`, `lastError`, `serverId`, `deliveredAt`.

## Decisions

**1. Which layer owns the durable outbox.** The `Outbox` class. It is the only writer, and it validates every change. `OutboxStore` is a three-method persistence interface (`loadAll`, `upsert`, `delete`): SQLite in the app, a JSON file in tests. Writes are persist-first: the row is on disk before memory changes or the UI is notified, so the screen is never ahead of storage. The trade-off is that a new message appears after one local write (milliseconds), not before it.

**2. Delivery-state transitions.**

```
pending ──▶ sending ──▶ delivered (terminal)
   ▲           ├──▶ pending   temporary failure with attempts left; went offline mid-request;
   │           │              crash recovery at startup
   │           └──▶ failed    attempts exhausted, or permanent rejection (e.g. 422)
   └────────── failed         manual retry (resets the attempt budget)
```

Anything else throws `InvalidTransitionError` (`src/domain/stateMachine.ts`, tested exhaustively). `sending` is written to disk before the request leaves, so if the app dies mid-request the message is recovered as `pending` at next launch.

**3. Ordering policy and trade-offs.** Per conversation, messages are sent one at a time in local `seq` order. `seq` is a monotonic counter persisted with the message, not the wall clock, so clock changes and same-millisecond messages cannot reorder anything. A message waiting out a backoff also holds back the ones behind it.
- `strict-fifo` (default): a `failed` message blocks later ones until the user retries or discards it. The server sees exactly what the user typed, in order, but one bad message stalls the queue.
- `skip-failed` (config flag): a `failed` message doesn't block. No head-of-line stall, but a manually retried message reaches the server after later ones, so readers must order by `clientSeq` (which the server stores).

**4. How connectivity triggers synchronization.** `NetInfoConnectivity` → `OverridableConnectivity` → `SyncEngine`. The engine runs a pass on an offline→online edge, and also on: app foreground, a new message, a manual retry, and when a backoff timer fires. While offline the pass exits immediately and no timers are pending. NetInfo can be optimistic (a captive portal reports "online"), so requests can still fail; those go through the normal retry path.

**5. Which failures are retried automatically.** Network errors, timeouts, HTTP 408/429/5xx: up to 5 attempts, backoff 1 s, 2 s, 4 s, 8 s (capped at 30 s), then `failed`. HTTP 4xx (other than 408/429) is permanent and goes straight to `failed`. A request that dies because the device went offline does not spend an attempt. Manual retry is always possible from `failed`. Backoff is deterministic here; production would add jitter.

**6. Where idempotency is enforced.** On the server: `MessageStore.accept` keeps a unique key on `clientMessageId` and returns the existing message (`duplicate: true`) on a repeat. The client never invents a new id for a retry; it sends the same one in the body and in an `Idempotency-Key` header. Reusing an id with different content is a `409`, not a silent overwrite. This is what makes an uncertain acknowledgement safe: "network error" is treated as "unknown", and the resend is harmless.

**7. How concurrent send and sync avoid corrupting state.** Four layers: (a) `SyncEngine.trigger()` is single-flight, and calls made during a pass set a flag so the running pass loops once more (nothing added mid-sync is missed, and two passes never send at once); (b) every `Outbox` mutation runs through one serial promise queue; (c) each mutation is checked against the state machine, so a stale or duplicate transition throws instead of overwriting; (d) each SQLite write is a single atomic statement.

**8. What changes for background synchronization in production.** Background execution while the app is terminated is out of scope here, but the design carries over: the outbox is already in SQLite, so an OS-scheduled task (iOS `BGProcessingTask` or background `URLSession`, Android WorkManager with a network constraint and unique work, or `expo-background-task` in Expo) can open the same database and run the same `SyncEngine` headlessly. Idempotency and crash recovery already cover the OS killing that task mid-request. It would also need a cross-process lock around the database, jitter in backoff, and the server's ack persisted so a background task doesn't rely on in-memory state.

### Follow-up: a permanently failing message must not block later ones forever

Use `skip-failed` (already implemented and tested): permanent rejections (4xx) become `failed` immediately and stop blocking, while temporary failures still hold the line briefly to keep order. To keep the conversation coherent, the client shows the failed message in place with Retry/Discard, and the server stores `clientSeq` so a late retry can be placed correctly. The remaining product question is whether later messages may depend on the failed one ("see my previous message"); if so, keep `strict-fifo` but add a time limit after which the head is parked and the queue continues.

## Simulating conditions (for reviewers)

The app has a **test controls** panel (toggle at the top). The same faults are available from the command line:

| Condition | In the app | Backend / CLI |
|---|---|---|
| Offline | "Simulate offline" switch (or airplane mode) | n/a |
| Online | Switch off | n/a |
| Slow | "Slow: on" (6 s latency; client times out at 5 s) | `curl -XPOST localhost:4000/admin/faults -d '{"latencyMs":6000}'` |
| Temporary failure | "Fail next 3 (503)" | `... -d '{"failNext":3}'` |
| Permanent rejection | "Reject next (422)" | `... -d '{"rejectNext":1}'` |
| Acknowledgement lost | "Lose next ack": server stores the message, then drops the connection | `... -d '{"dropAckNext":1}'` |
| Check server state | "Count on server" | `curl localhost:4000/conversations/demo/messages` |
| Reset | "Reset server" | `curl -XPOST localhost:4000/admin/reset` |

Force-close durability: send a message while offline, swipe the app away (or reload from the dev menu), reopen it. The message is back with its state; switch offline off and it syncs.

## Acceptance scenarios → tests

| Scenario | Test (`test/`) |
|---|---|
| AC1 offline send | `outbox.test.ts`: "AC1: an offline send is stored locally as pending…" |
| AC2 force-close durability | `outbox.test.ts`: "AC2: pending messages and their states survive an app restart" |
| AC3 reconnection sync, ordering | `syncEngine.test.ts`: "AC3: reconnecting sends pending messages in… order" |
| AC4 temporary failure, bounded retry, manual retry | `syncEngine.test.ts`: "AC4: …" (two tests) |
| AC5 uncertain acknowledgement | `syncEngine.test.ts`: "AC5…", `server.test.ts`: real-HTTP dropped-ack test |
| Concurrency, policies, crash mid-request | `syncEngine.test.ts` (strict-fifo, skip-failed, overlapping triggers, recovery) |

The sync engine runs against a fake clock, scripted connectivity, and an in-process backend, so no test needs a real network change. "Restart" in tests means building a brand-new `Outbox` and `SyncEngine` on the same durable file.

## Verification benchmark

```bash
npm run benchmark
```

Real HTTP server, real `HttpTransport`, real timers (short backoff). It queues 12 messages offline, restarts (new objects, same durable file), injects one 503 and one lost acknowledgement (armed at message 6), restores connectivity, and asserts every message exists exactly once on the backend, in local order, with all 12 delivered on the client. Exits non-zero on any failure. Expected: `PASS`, 14 requests for 12 messages.

## Demo checklist

1. Show the test controls panel; toggle offline, trigger "Fail next 3", "Lose next ack".
2. Send 3 messages offline, force-close, reopen: same messages, all pending.
3. Go online: sync in order; with "Fail next 3" armed, watch the failure text and the retry.
4. With "Lose next ack" armed, send one: it stays pending, then delivers; "Count on server" shows one copy.
5. Run `npm run benchmark`, then walk through the architecture diagram and one trade-off (strict-fifo vs skip-failed).

## Known limitations

- If the local database write fails right after a successful acknowledgement, the message stays `sending` until the next launch, where recovery resends it and the server dedupes. Fine for a prototype; production would retry the write.
- Delivered messages stay in the outbox table as the local record of sent messages; there is no pruning or separate message history.
- Only outgoing messages are modelled; incoming responses are out of scope.
- The tests use a file-backed store, not SQLite, so the SQLite adapter (`SqliteOutboxStore`) and the React Native UI are exercised only by running the app.
