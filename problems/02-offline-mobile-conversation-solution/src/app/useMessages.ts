import { useEffect, useState } from 'react';
import type { OutboxMessage } from '../domain/types';
import type { Outbox } from '../outbox/Outbox';

/** Screen state is a read-only mirror of the outbox. */
export function useMessages(outbox: Outbox, conversationId: string): readonly OutboxMessage[] {
  const [messages, setMessages] = useState(() => outbox.list(conversationId));
  useEffect(() => {
    setMessages(outbox.list(conversationId));
    return outbox.subscribe(() => setMessages(outbox.list(conversationId)));
  }, [outbox, conversationId]);
  return messages;
}

export function useOnline(connectivity: { isOnline(): boolean; subscribe(l: (o: boolean) => void): () => void }): boolean {
  const [online, setOnline] = useState(connectivity.isOnline());
  useEffect(() => {
    setOnline(connectivity.isOnline());
    return connectivity.subscribe(setOnline);
  }, [connectivity]);
  return online;
}
