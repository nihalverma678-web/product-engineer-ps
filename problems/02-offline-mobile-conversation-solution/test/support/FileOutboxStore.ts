import fs from 'node:fs';
import type { OutboxMessage } from '../../src/domain/types';
import type { OutboxStore } from '../../src/outbox/Outbox';

/**
 * File-backed OutboxStore for tests and the benchmark. Writes go to a temp file then
 * rename, so a "crash" never leaves a half-written file. Constructing a new instance on
 * the same path is the test equivalent of relaunching the app.
 */
export class FileOutboxStore implements OutboxStore {
  constructor(private readonly path: string) {}

  async loadAll(): Promise<OutboxMessage[]> {
    if (!fs.existsSync(this.path)) return [];
    return JSON.parse(fs.readFileSync(this.path, 'utf8')) as OutboxMessage[];
  }

  async upsert(m: OutboxMessage): Promise<void> {
    const rows = await this.loadAll();
    const i = rows.findIndex((r) => r.id === m.id);
    if (i >= 0) rows[i] = m;
    else rows.push(m);
    this.write(rows);
  }

  async delete(id: string): Promise<void> {
    this.write((await this.loadAll()).filter((r) => r.id !== id));
  }

  private write(rows: OutboxMessage[]): void {
    const tmp = `${this.path}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(rows));
    fs.renameSync(tmp, this.path);
  }
}
