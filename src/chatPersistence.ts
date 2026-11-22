type ChatMessage = { role: "user" | "assistant"; content: string };

const CHAT_HISTORY_STORAGE_KEY = "laural.chat.v1";
export const MAX_CHAT_MESSAGES = 100;
const MAX_STORED_MESSAGE_LENGTH = 20_000;

export function limitChatMessages<T extends ChatMessage>(messages: T[]): T[];
export function limitChatMessages<T extends ChatMessage>(messages: readonly T[]): readonly T[];
export function limitChatMessages<T extends ChatMessage>(messages: readonly T[]): readonly T[] {
  return messages.length > MAX_CHAT_MESSAGES ? messages.slice(-MAX_CHAT_MESSAGES) : messages;
}

export function createChatHistoryPersistence(storage: Pick<Storage, "setItem">, intervalMs = 500) {
  let pendingMessages: readonly ChatMessage[] | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (pendingMessages === null) return;

    const messages = pendingMessages;
    pendingMessages = null;
    const bounded = limitChatMessages(messages).map(({ role, content }) => ({
      role,
      content: content.slice(0, MAX_STORED_MESSAGE_LENGTH),
    }));
    try {
      storage.setItem(CHAT_HISTORY_STORAGE_KEY, JSON.stringify(bounded));
    } catch {
      // El chat sigue disponible aunque el almacenamiento local falle.
    }
  }

  function schedule(messages: readonly ChatMessage[]) {
    pendingMessages = messages;
    if (timer === null) timer = setTimeout(flush, intervalMs);
  }

  function cancel() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pendingMessages = null;
  }

  return { schedule, flush, cancel };
}
