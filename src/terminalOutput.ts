export const COMMAND_BLOCK_OUTPUT_LIMIT = 8_000;
const TERMINAL_CONTEXT_OUTPUT_LIMIT = 24_000;

export function appendTerminalOutput(
  previous: string,
  chunk: string,
  limit = TERMINAL_CONTEXT_OUTPUT_LIMIT,
): string {
  const tail = chunk.length >= limit ? chunk.slice(-limit) : previous.slice(chunk.length - limit) + chunk;
  const first = tail.charCodeAt(0);
  return first >= 0xdc00 && first <= 0xdfff ? tail.slice(1) : tail;
}
