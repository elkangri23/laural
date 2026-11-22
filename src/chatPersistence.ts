import { limitChatMessages, type ChatHistoryMessage } from "./chatHistory";

const CHAT_HISTORY_STORAGE_KEY = "laural.chat.v1";
const MAX_STORED_MESSAGE_LENGTH = 20_000;

export function createChatHistoryPersistence(storage: Pick<Storage, "setItem">, intervalMs = 500) {
  let pendingMessages: readonly ChatHistoryMessage[] | null = null;
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

  function schedule(messages: readonly ChatHistoryMessage[]) {
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
