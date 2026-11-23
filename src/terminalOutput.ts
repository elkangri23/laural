export const COMMAND_BLOCK_OUTPUT_LIMIT = 8_000;
const TERMINAL_CONTEXT_OUTPUT_LIMIT = 24_000;
const TERMINAL_TEXT_BATCH_MS = 16;
const TERMINAL_TEXT_BATCH_COMPACT_THRESHOLD = 256;
const TERMINAL_OUTPUT_BYTE_LIMIT = 32 * 1024;
const TERMINAL_OUTPUT_BASE64_LIMIT = Math.ceil(TERMINAL_OUTPUT_BYTE_LIMIT / 3) * 4;
const TERMINAL_OUTPUT_BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export type TerminalSize = { rows: number; cols: number };

export function terminalSizeChanged(previous: TerminalSize | null, next: TerminalSize) {
  return next.rows > 0 && next.cols > 0 && (previous === null || previous.rows !== next.rows || previous.cols !== next.cols);
}

export function decodeTerminalOutput(dataBase64: string): Uint8Array | null {
  if (dataBase64.length > TERMINAL_OUTPUT_BASE64_LIMIT || !TERMINAL_OUTPUT_BASE64_PATTERN.test(dataBase64)) return null;
  try {
    const binary = atob(dataBase64);
    if (binary.length > TERMINAL_OUTPUT_BYTE_LIMIT) return null;
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

export function appendTerminalOutput(
  previous: string,
  chunk: string,
  limit = TERMINAL_CONTEXT_OUTPUT_LIMIT,
): string {
  const tail = chunk.length >= limit ? chunk.slice(-limit) : previous.slice(chunk.length - limit) + chunk;
  const first = tail.charCodeAt(0);
  return first >= 0xdc00 && first <= 0xdfff ? tail.slice(1) : tail;
}

function createBoundedTextBuffer(limit: number) {
  let chunks: string[] = [];
  let firstChunk = 0;
  let length = 0;

  function push(text: string) {
    if (text.length >= limit) {
      chunks = [text.slice(-limit)];
      firstChunk = 0;
      length = limit;
      return;
    }

    chunks.push(text);
    length += text.length;
    while (length > limit) {
      const excess = length - limit;
      const first = chunks[firstChunk];
      if (first.length <= excess) {
        length -= first.length;
        chunks[firstChunk] = "";
        firstChunk += 1;
      } else {
        chunks[firstChunk] = first.slice(excess);
        length -= excess;
      }
    }

    if (firstChunk >= TERMINAL_TEXT_BATCH_COMPACT_THRESHOLD && firstChunk * 2 >= chunks.length) {
      chunks = chunks.slice(firstChunk);
      firstChunk = 0;
    }
  }

  function take() {
    if (length === 0) return "";
    const text = chunks.slice(firstChunk).join("");
    chunks = [];
    firstChunk = 0;
    length = 0;
    const first = text.charCodeAt(0);
    return first >= 0xdc00 && first <= 0xdfff ? text.slice(1) : text;
  }

  function clear() {
    chunks = [];
    firstChunk = 0;
    length = 0;
  }

  return { push, take, clear };
}

export function createTerminalTextBatcher(onText: (text: string) => void, delayMs = TERMINAL_TEXT_BATCH_MS) {
  const pending = createBoundedTextBuffer(TERMINAL_CONTEXT_OUTPUT_LIMIT);
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const text = pending.take();
    if (text) onText(text);
  }

  function push(text: string) {
    if (!text) return;
    pending.push(text);
    if (timer === null) timer = setTimeout(flush, delayMs);
  }

  function cancel() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending.clear();
  }

  return { push, flush, cancel };
}
