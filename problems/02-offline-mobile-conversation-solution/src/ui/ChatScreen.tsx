import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { CONVERSATION_ID, SYNC_CONFIG } from '../app/config';
import type { Runtime } from '../app/runtime';
import { useMessages, useOnline } from '../app/useMessages';
import type { DeliveryState, OutboxMessage } from '../domain/types';
import { DebugPanel } from './DebugPanel';
import { statusLabel } from './statusLabel';

const STATE_COLOR: Record<DeliveryState, string> = {
  pending: '#8a5a00',
  sending: '#4a5568',
  failed: '#b3261e',
  delivered: '#1e6b3a',
};

export function ChatScreen({ runtime }: { runtime: Runtime }) {
  const { outbox, service, connectivity } = runtime;
  const messages = useMessages(outbox, CONVERSATION_ID);
  const online = useOnline(connectivity);
  const [draft, setDraft] = useState('');
  const [showDebug, setShowDebug] = useState(true);
  const listRef = useRef<FlatList<OutboxMessage>>(null);

  useEffect(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, [messages.length]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    try {
      await service.send(text);
    } catch {
      setDraft(text); // could not even be stored locally: give the text back
    }
  }, [draft, service]);

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <Text style={styles.title}>Conversation</Text>
        <Text style={[styles.conn, { color: online ? '#1e6b3a' : '#b3261e' }]}>{online ? 'Online' : 'Offline'}</Text>
        <Pressable onPress={() => setShowDebug((v) => !v)}>
          <Text style={styles.link}>{showDebug ? 'Hide test controls' : 'Show test controls'}</Text>
        </Pressable>
      </View>
      {showDebug ? <DebugPanel runtime={runtime} online={online} /> : null}

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>Send a message. It is saved on this device first, so it is never lost, even offline.</Text>}
        renderItem={({ item }) => (
          <View style={styles.bubble}>
            <Text style={styles.content}>{item.content}</Text>
            <Text style={[styles.status, { color: STATE_COLOR[item.state] }]}>
              {statusLabel(item, online, SYNC_CONFIG.retry.maxAttempts)}
            </Text>
            {item.state === 'failed' ? (
              <View style={styles.actions}>
                <Pressable onPress={() => void service.retry(item.id)}><Text style={styles.action}>Retry</Text></Pressable>
                <Pressable onPress={() => void service.discard(item.id)}><Text style={styles.action}>Discard</Text></Pressable>
              </View>
            ) : null}
          </View>
        )}
      />

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Write a message"
          multiline
        />
        <Pressable onPress={() => void send()} style={[styles.sendBtn, !draft.trim() && styles.sendDisabled]} disabled={!draft.trim()}>
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fafafa' },
  header: { paddingTop: 56, paddingHorizontal: 16, paddingBottom: 10, flexDirection: 'row', alignItems: 'baseline', gap: 12, backgroundColor: '#ffffff', borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#d5d8dd' },
  title: { fontSize: 20, fontWeight: '600', color: '#1c2430', flex: 1 },
  conn: { fontSize: 14, fontWeight: '500' },
  link: { fontSize: 13, color: '#2b5cab' },
  list: { padding: 16, gap: 10, flexGrow: 1 },
  empty: { color: '#6a7482', fontSize: 15, lineHeight: 22, marginTop: 24 },
  bubble: { alignSelf: 'flex-end', maxWidth: '85%', backgroundColor: '#e3ebf7', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12 },
  content: { fontSize: 16, color: '#1c2430', lineHeight: 22 },
  status: { fontSize: 12, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 16, marginTop: 6 },
  action: { fontSize: 14, fontWeight: '600', color: '#2b5cab' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, paddingBottom: 24, backgroundColor: '#ffffff', borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#d5d8dd' },
  input: { flex: 1, maxHeight: 120, minHeight: 40, paddingHorizontal: 12, paddingVertical: 8, fontSize: 16, backgroundColor: '#f1f3f5', borderRadius: 10 },
  sendBtn: { height: 40, paddingHorizontal: 16, borderRadius: 10, backgroundColor: '#2b5cab', justifyContent: 'center' },
  sendDisabled: { opacity: 0.4 },
  sendText: { color: '#ffffff', fontWeight: '600', fontSize: 15 },
});
