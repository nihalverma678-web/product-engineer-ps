import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, Text, View } from 'react-native';
import { createRuntime, type Runtime } from './src/app/runtime';
import { ChatScreen } from './src/ui/ChatScreen';

export default function App() {
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    createRuntime()
      .then((r) => !cancelled && setRuntime(r))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, []);

  // Returning to the foreground is a good moment to try again (backoff timers may have been paused).
  useEffect(() => {
    if (!runtime) return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void runtime.engine.trigger();
    });
    return () => sub.remove();
  }, [runtime]);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>Couldn't open local storage: {error}</Text>
      </View>
    );
  }
  if (!runtime) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  return (
    <>
      <StatusBar style="dark" />
      <ChatScreen runtime={runtime} />
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  error: { fontSize: 16, color: '#b3261e', textAlign: 'center' },
});
