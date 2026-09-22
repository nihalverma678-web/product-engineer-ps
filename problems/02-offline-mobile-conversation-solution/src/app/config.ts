import { Platform } from 'react-native';
import { DEFAULT_RETRY } from '../domain/backoff';
import type { SyncConfig } from '../sync/SyncEngine';

export const CONVERSATION_ID = 'demo';

/**
 * Where the mock backend runs (`npm run server`).
 *  - iOS simulator:      http://localhost:4000
 *  - Android emulator:   http://10.0.2.2:4000
 *  - Physical device:    set EXPO_PUBLIC_API_URL=http://<your-computer-LAN-IP>:4000
 */
export const API_URL: string =
  process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === 'android' ? 'http://10.0.2.2:4000' : 'http://localhost:4000');

export const SYNC_CONFIG: SyncConfig = {
  retry: DEFAULT_RETRY, // 5 attempts, 1 s base delay, doubling, capped at 30 s
  policy: 'strict-fifo',
};
