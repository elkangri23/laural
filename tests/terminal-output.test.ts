import { expect, test } from "vitest";
import { appendTerminalOutput } from "../src/terminalOutput";

test("conserva la cola de una ráfaga grande aunque llegue en fragmentos", () => {
  const raw = Array.from({ length: 1500 }, (_, i) => `línea ${i} — abcdefghijklmnopqrstuvwxyz\n`).join("");
  let tail = "";
  for (let i = 0; i < raw.length; i += 511) {
    tail = appendTerminalOutput(tail, raw.slice(i, i + 511));
    expect(tail.length).toBeLessThanOrEqual(24_000);
  }
  expect(tail).toBe(raw.slice(-24_000));
  expect(appendTerminalOutput("anterior", raw)).toBe(tail);
});

test("el recorte respeta los caracteres que ocupan dos unidades UTF-16", () => {
  const suffix = "x".repeat(23_999);
  expect(appendTerminalOutput("📁", suffix)).toBe(suffix);
  expect(appendTerminalOutput("", "📁" + suffix)).toBe(suffix);
  expect(appendTerminalOutput("📁", "")).toBe("📁");
});

test("mantiene una cola menor para los bloques visuales de comandos", () => {
  const limit = 8_000;
  const first = "a".repeat(limit);
  const output = appendTerminalOutput(first, "fin", limit);

  expect(output).toHaveLength(limit);
  expect(output).toBe(`${"a".repeat(limit - 3)}fin`);
});
