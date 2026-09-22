/** Debug-only client for the mock backend's fault-injection endpoints. */
export interface Faults {
  failNext: number;
  rejectNext: number;
  dropAckNext: number;
  latencyMs: number;
}

export class AdminClient {
  constructor(private readonly baseUrl: string) {}

  setFaults(partial: Partial<Faults>): Promise<Faults> {
    return this.call('/admin/faults', 'POST', partial) as Promise<Faults>;
  }

  async reset(): Promise<void> {
    await this.call('/admin/reset', 'POST', {});
  }

  async serverMessageCount(conversationId: string): Promise<number> {
    const body = (await this.call(`/conversations/${encodeURIComponent(conversationId)}/messages`, 'GET')) as {
      messages: unknown[];
    };
    return body.messages.length;
  }

  private async call(path: string, method: 'GET' | 'POST', body?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }
}
