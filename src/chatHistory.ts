export type ChatHistoryMessage = { role: "user" | "assistant"; content: string };

export const MAX_CHAT_MESSAGES = 100;
const MAX_REQUEST_HISTORY_MESSAGES = 20;
const MAX_REQUEST_MESSAGE_CHARS = 8_000;

export function limitChatMessages<T extends ChatHistoryMessage>(messages: T[]): T[];
export function limitChatMessages<T extends ChatHistoryMessage>(messages: readonly T[]): readonly T[];
export function limitChatMessages<T extends ChatHistoryMessage>(messages: readonly T[]): readonly T[] {
  return messages.length > MAX_CHAT_MESSAGES ? messages.slice(-MAX_CHAT_MESSAGES) : messages;
}

function takeCharacters(text: string, limit: number) {
  if (text.length <= limit) return text;
  let end = 0;
  for (const character of text) {
    end += character.length;
    if (--limit === 0) break;
  }
  return text.slice(0, end);
}

export function prepareChatHistoryForRequest(messages: readonly ChatHistoryMessage[]) {
  return messages.slice(-MAX_REQUEST_HISTORY_MESSAGES).map(({ role, content }) => ({
    role,
    content: takeCharacters(content, MAX_REQUEST_MESSAGE_CHARS),
  }));
}
