import { Outbox } from '../outbox/Outbox';
import { SqliteOutboxStore } from '../outbox/SqliteOutboxStore';
import { systemClock } from '../sync/Clock';
import { OverridableConnectivity } from '../sync/Connectivity';
import { HttpTransport } from '../sync/HttpTransport';
import { NetInfoConnectivity } from '../sync/NetInfoConnectivity';
import { SyncEngine } from '../sync/SyncEngine';
import { AdminClient } from './AdminClient';
import { API_URL, CONVERSATION_ID, SYNC_CONFIG } from './config';
import { ConversationService } from './ConversationService';

export interface Runtime {
  outbox: Outbox;
  engine: SyncEngine;
  service: ConversationService;
  connectivity: OverridableConnectivity;
  admin: AdminClient;
}

/** The single composition root: the only place concrete implementations are chosen. */
export async function createRuntime(): Promise<Runtime> {
  const store = await SqliteOutboxStore.open();
  const outbox = new Outbox(store, systemClock);
  await outbox.init(); // restores messages left over from the previous run

  const connectivity = new OverridableConnectivity(new NetInfoConnectivity());
  const engine = new SyncEngine({
    outbox,
    transport: new HttpTransport(API_URL, 5000),
    connectivity,
    clock: systemClock,
    config: SYNC_CONFIG,
    onError: (e) => console.warn('[sync]', e),
  });
  engine.start();

  return {
    outbox,
    engine,
    connectivity,
    service: new ConversationService(outbox, engine, CONVERSATION_ID),
    admin: new AdminClient(API_URL),
  };
}
