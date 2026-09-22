import * as SQLite from 'expo-sqlite';
import type { DeliveryState, OutboxMessage } from '../domain/types';
import type { OutboxStore } from './Outbox';

interface Row {
  id: string;
  conversation_id: string;
  content: string;
  created_at: number;
  seq: number;
  state: string;
  attempts: number;
  next_attempt_at: number | null;
  last_error: string | null;
  server_id: string | null;
  delivered_at: number | null;
}

/** Durable outbox on SQLite. Each upsert is one atomic statement, so a kill leaves whole rows. */
export class SqliteOutboxStore implements OutboxStore {
  private constructor(private readonly db: SQLite.SQLiteDatabase) {}

  static async open(name = 'outbox.db'): Promise<SqliteOutboxStore> {
    const db = await SQLite.openDatabaseAsync(name);
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS outbox (
        id              TEXT PRIMARY KEY NOT NULL,
        conversation_id TEXT NOT NULL,
        content         TEXT NOT NULL,
        created_at      INTEGER NOT NULL,
        seq             INTEGER NOT NULL,
        state           TEXT NOT NULL,
        attempts        INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER,
        last_error      TEXT,
        server_id       TEXT,
        delivered_at    INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_outbox_conversation_seq ON outbox (conversation_id, seq);
    `);
    return new SqliteOutboxStore(db);
  }

  async loadAll(): Promise<OutboxMessage[]> {
    const rows = await this.db.getAllAsync<Row>('SELECT * FROM outbox ORDER BY seq ASC');
    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      content: r.content,
      createdAt: r.created_at,
      seq: r.seq,
      state: r.state as DeliveryState,
      attempts: r.attempts,
      nextAttemptAt: r.next_attempt_at,
      lastError: r.last_error,
      serverId: r.server_id,
      deliveredAt: r.delivered_at,
    }));
  }

  async upsert(m: OutboxMessage): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO outbox (id, conversation_id, content, created_at, seq, state, attempts,
                           next_attempt_at, last_error, server_id, delivered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         state = excluded.state,
         attempts = excluded.attempts,
         next_attempt_at = excluded.next_attempt_at,
         last_error = excluded.last_error,
         server_id = excluded.server_id,
         delivered_at = excluded.delivered_at`,
      [
        m.id, m.conversationId, m.content, m.createdAt, m.seq, m.state, m.attempts,
        m.nextAttemptAt, m.lastError, m.serverId, m.deliveredAt,
      ],
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.runAsync('DELETE FROM outbox WHERE id = ?', [id]);
  }
}
