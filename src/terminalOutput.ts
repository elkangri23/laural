// Keep terminal context and command blocks within the same UTF-16 storage budget.
export function appendTerminalOutput(previous: string, chunk: string): string {
  const limit = 24_000;
  const tail = chunk.length >= limit ? chunk.slice(-limit) : previous.slice(chunk.length - limit) + chunk;
  const first = tail.charCodeAt(0);
  return first >= 0xdc00 && first <= 0xdfff ? tail.slice(1) : tail;
}
