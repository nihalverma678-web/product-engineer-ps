import http from 'node:http';
import { FaultPlan } from './FaultPlan';
import { MessageStore } from './MessageStore';
import { processSend } from './processSend';

/**
 * Mock backend.
 *   POST /conversations/:id/messages   send (idempotent on clientMessageId)
 *   GET  /conversations/:id/messages   list in server arrival order
 *   GET  /admin/faults                 current fault plan
 *   POST /admin/faults                 set { failNext, rejectNext, dropAckNext, latencyMs }
 *   POST /admin/reset                  clear faults and stored messages
 */
export function createHttpServer(store = new MessageStore(), faults = new FaultPlan()) {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:8081');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, idempotency-key'
    );

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    try {
      if (url.pathname === '/admin/faults' && req.method === 'GET') return json(200, faults.snapshot());
      if (url.pathname === '/admin/faults' && req.method === 'POST') {
        faults.set((await readJson(req)) as object);
        return json(200, faults.snapshot());
      }
      if (url.pathname === '/admin/reset' && req.method === 'POST') {
        faults.reset();
        store.clear();
        return json(200, { ok: true });
      }

      const m = /^\/conversations\/([^/]+)\/messages$/.exec(url.pathname);
      if (m) {
        const conversationId = decodeURIComponent(m[1]);
        if (req.method === 'GET') return json(200, { messages: store.list(conversationId) });
        if (req.method === 'POST') {
          const body = await readJson(req);
          if (faults.latencyMs > 0) await new Promise((r) => setTimeout(r, faults.latencyMs));
          const result = processSend(store, faults, conversationId, body);
          if (result.dropAck) {
            req.socket.destroy(); // stored, but the client never hears back
            return;
          }
          return json(result.status, result.body);
        }
      }
      json(404, { error: 'Not found' });
    } catch {
      json(400, { error: 'Bad request' });
    }
  });
  return { server, store, faults };
}

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}
