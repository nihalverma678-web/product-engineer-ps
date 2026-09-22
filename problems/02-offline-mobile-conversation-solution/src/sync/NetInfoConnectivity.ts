import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import type { Connectivity } from './Connectivity';

/** Real device connectivity. Optimistic (online) until NetInfo reports otherwise. */
export class NetInfoConnectivity implements Connectivity {
  private online = true;
  private listeners = new Set<(online: boolean) => void>();
  private unsubscribeNative: () => void;

  constructor() {
    this.unsubscribeNative = NetInfo.addEventListener((s) => this.apply(s));
    void NetInfo.fetch().then((s) => this.apply(s));
  }

  isOnline(): boolean {
    return this.online;
  }

  subscribe(listener: (online: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.unsubscribeNative();
  }

  private apply(s: NetInfoState): void {
    // isInternetReachable is null while unknown; only an explicit false means "no internet".
    const next = s.isConnected === true && s.isInternetReachable !== false;
    if (next === this.online) return;
    this.online = next;
    for (const l of [...this.listeners]) l(next);
  }
}
