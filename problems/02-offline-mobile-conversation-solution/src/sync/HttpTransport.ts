import { classifyStatus, TransportError, type SendAck, type SendRequest, type Transport } from './Transport';

export class HttpTransport implements Transport {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs = 5000,
    private readonly fetchImpl: typeof fetch = fetch.bind(globalThis),
  ) {}

  async send(req: SendRequest): Promise<SendAck> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(
        `${this.baseUrl}/conversations/${encodeURIComponent(req.conversationId)}/messages`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': req.clientMessageId },
          body: JSON.stringify(req),
          signal: controller.signal,
        },
      );
    } catch (e) {
      if (controller.signal.aborted) throw new TransportError('timeout', `No response within ${this.timeoutMs} ms`);
      throw new TransportError('network', e instanceof Error ? e.message : 'Network request failed');
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) throw new TransportError(classifyStatus(res.status), `HTTP ${res.status}`, res.status);

    try {
      const body = (await res.json()) as { serverId?: string; duplicate?: boolean };
      if (!body.serverId) throw new Error('missing serverId');
      return { serverId: body.serverId, duplicate: body.duplicate === true };
    } catch {
      // 2xx with an unreadable body: the outcome is unclear, and retrying is safe (idempotent).
      throw new TransportError('temporary', 'Unreadable acknowledgement');
    }
  }
}
