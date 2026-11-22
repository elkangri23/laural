export const COMMAND_BLOCK_OUTPUT_LIMIT = 8_000;
const TERMINAL_CONTEXT_OUTPUT_LIMIT = 24_000;
const TERMINAL_TEXT_BATCH_MS = 16;

export function appendTerminalOutput(
  previous: string,
  chunk: string,
  limit = TERMINAL_CONTEXT_OUTPUT_LIMIT,
): string {
  const tail = chunk.length >= limit ? chunk.slice(-limit) : previous.slice(chunk.length - limit) + chunk;
  const first = tail.charCodeAt(0);
  return first >= 0xdc00 && first <= 0xdfff ? tail.slice(1) : tail;
}

export function createTerminalTextBatcher(onText: (text: string) => void, delayMs = TERMINAL_TEXT_BATCH_MS) {
  let pending = "";
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (!pending) return;
    const text = pending;
    pending = "";
    onText(text);
  }

  function push(text: string) {
    if (!text) return;
    pending = appendTerminalOutput(pending, text, TERMINAL_CONTEXT_OUTPUT_LIMIT);
    if (timer === null) timer = setTimeout(flush, delayMs);
  }

  function cancel() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending = "";
  }

  return { push, flush, cancel };
}
