export function createStreamingTextBuffer() {
  let content = "";
  let pending: string[] = [];

  function append(fragment: string) {
    if (fragment) pending.push(fragment);
  }

  function snapshot() {
    if (pending.length > 0) {
      content += pending.join("");
      pending = [];
    }
    return content;
  }

  function clear() {
    content = "";
    pending = [];
  }

  return { append, snapshot, clear };
}
