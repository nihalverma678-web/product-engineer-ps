import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import type { Runtime } from '../app/runtime';
import { CONVERSATION_ID } from '../app/config';

/** Reviewer controls for simulating offline, slow, failing, and acknowledgement-lost behaviour. */
export function DebugPanel({ runtime, online }: { runtime: Runtime; online: boolean }) {
  const [note, setNote] = useState('');
  const [slow, setSlow] = useState(false);
  const [forcedOffline, setForcedOffline] = useState(runtime.connectivity.isForcedOffline());

  const run = useCallback(async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      setNote(label);
    } catch (e) {
      setNote(`Backend unreachable: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const { admin, connectivity } = runtime;

  return (
    <View style={styles.panel}>
      <View style={styles.row}>
        <Text style={styles.label}>Simulate offline (device is {online ? 'online' : 'offline'})</Text>
        <Switch
          value={forcedOffline}
          onValueChange={(v) => {
            setForcedOffline(v);
            connectivity.setForcedOffline(v);
          }}
        />
      </View>
      <View style={styles.buttons}>
        <Btn title="Fail next 3 (503)" onPress={() => run('Next 3 requests fail with 503', () => admin.setFaults({ failNext: 3 }))} />
        <Btn title="Lose next ack" onPress={() => run('Next request is stored, then its ack is lost', () => admin.setFaults({ dropAckNext: 1 }))} />
        <Btn title="Reject next (422)" onPress={() => run('Next request is rejected with 422', () => admin.setFaults({ rejectNext: 1 }))} />
        <Btn
          title={slow ? 'Slow: on (6 s)' : 'Slow: off'}
          onPress={() => {
            const next = !slow;
            setSlow(next);
            void run(next ? 'Responses now take 6 s (client times out at 5 s)' : 'Responses back to normal', () =>
              admin.setFaults({ latencyMs: next ? 6000 : 0 }),
            );
          }}
        />
        <Btn
          title="Count on server"
          onPress={() =>
            run('', async () => {
              const n = await admin.serverMessageCount(CONVERSATION_ID);
              setNote(`Server holds ${n} message${n === 1 ? '' : 's'}`);
            })
          }
        />
        <Btn
          title="Reset server"
          onPress={() => {
            setSlow(false);
            void run('Server cleared', () => admin.reset());
          }}
        />
      </View>
      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

function Btn({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}>
      <Text style={styles.btnText}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: { padding: 12, backgroundColor: '#eef1f4', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#c8ced6' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 14, color: '#1c2430', flexShrink: 1 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  btn: { paddingVertical: 7, paddingHorizontal: 10, backgroundColor: '#ffffff', borderRadius: 6, borderWidth: 1, borderColor: '#aab3bf' },
  btnPressed: { backgroundColor: '#dfe4ea' },
  btnText: { fontSize: 13, color: '#1c2430' },
  note: { marginTop: 8, fontSize: 13, color: '#3b4655' },
});
