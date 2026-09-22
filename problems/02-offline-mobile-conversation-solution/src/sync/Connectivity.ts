export interface Connectivity {
  isOnline(): boolean;
  /** Listener fires on every change. Returns an unsubscribe function. */
  subscribe(listener: (online: boolean) => void): () => void;
}

/** Fully scriptable connectivity for tests. */
export class ManualConnectivity implements Connectivity {
  private listeners = new Set<(online: boolean) => void>();
  constructor(private online = true) {}

  isOnline(): boolean {
    return this.online;
  }

  setOnline(online: boolean): void {
    if (online === this.online) return;
    this.online = online;
    for (const l of [...this.listeners]) l(online);
  }

  subscribe(listener: (online: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/**
 * Wraps a real connectivity source and adds a "simulate offline" switch,
 * so a reviewer can go offline without touching airplane mode.
 */
export class OverridableConnectivity implements Connectivity {
  private forcedOffline = false;
  private listeners = new Set<(online: boolean) => void>();
  private last: boolean;

  constructor(private readonly base: Connectivity) {
    this.last = base.isOnline();
    base.subscribe(() => this.emit());
  }

  isOnline(): boolean {
    return !this.forcedOffline && this.base.isOnline();
  }

  setForcedOffline(value: boolean): void {
    this.forcedOffline = value;
    this.emit();
  }

  isForcedOffline(): boolean {
    return this.forcedOffline;
  }

  subscribe(listener: (online: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const now = this.isOnline();
    if (now === this.last) return;
    this.last = now;
    for (const l of [...this.listeners]) l(now);
  }
}
