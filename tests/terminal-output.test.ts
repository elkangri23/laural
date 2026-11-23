import { afterEach, expect, test, vi } from "vitest";
import { appendTerminalOutput, createTerminalOutputBatcher, createTerminalTextBatcher, decodeTerminalOutput, terminalSizeChanged } from "../src/terminalOutput";
import fixture from "../shared/fixtures/terminal-output-event.json";

afterEach(() => vi.useRealTimers());

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

test("agrupa la captura de texto PTY y limita la cola al sufijo útil", () => {
  vi.useFakeTimers();
  const onText = vi.fn();
  const batcher = createTerminalTextBatcher(onText, 16);
  batcher.push("primero");
  batcher.push(" segundo");

  vi.advanceTimersByTime(15);
  expect(onText).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(onText).toHaveBeenCalledWith("primero segundo");

  batcher.push("x".repeat(24_001));
  batcher.flush();
  expect(onText).toHaveBeenLastCalledWith("x".repeat(24_000));
});

test("agrupa escrituras xterm durante 16 ms y conserva todos los bytes en orden", () => {
  vi.useFakeTimers();
  const onOutput = vi.fn();
  const batcher = createTerminalOutputBatcher(onOutput, 16);
  batcher.push(new Uint8Array([0xf0, 0x9f]));
  batcher.push(new Uint8Array([0x8c, 0x8d]));

  vi.advanceTimersByTime(15);
  expect(onOutput).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);

  expect(onOutput).toHaveBeenCalledOnce();
  expect(Array.from(onOutput.mock.calls[0][0] as Uint8Array)).toEqual([0xf0, 0x9f, 0x8c, 0x8d]);
});

test("vacía xterm inmediatamente al alcanzar el límite de 256 KiB", () => {
  vi.useFakeTimers();
  const onOutput = vi.fn();
  const batcher = createTerminalOutputBatcher(onOutput);
  const chunk = new Uint8Array(32 * 1024).fill(65);

  for (let index = 0; index < 8; index += 1) batcher.push(chunk);

  expect(onOutput).toHaveBeenCalledOnce();
  expect(onOutput.mock.calls[0][0]).toHaveLength(256 * 1024);
  vi.advanceTimersByTime(16);
  expect(onOutput).toHaveBeenCalledOnce();
});

test("reduce a ocho las escrituras xterm de una ráfaga de 64 eventos máximos", () => {
  vi.useFakeTimers();
  const onOutput = vi.fn();
  const batcher = createTerminalOutputBatcher(onOutput);
  const chunk = new Uint8Array(32 * 1024).fill(65);

  for (let index = 0; index < 64; index += 1) batcher.push(chunk);

  expect(onOutput).toHaveBeenCalledTimes(8);
  expect(onOutput.mock.calls.reduce((total, [bytes]) => total + (bytes as Uint8Array).length, 0))
    .toBe(64 * 32 * 1024);
});

test("el vaciado final conserva un fragmento y cancelar elimina la cola pendiente", () => {
  vi.useFakeTimers();
  const onOutput = vi.fn();
  const batcher = createTerminalOutputBatcher(onOutput);
  const chunk = new Uint8Array([1, 2, 3]);

  batcher.push(chunk);
  batcher.flush();
  expect(onOutput).toHaveBeenCalledWith(chunk);

  batcher.push(new Uint8Array([4]));
  batcher.cancel();
  vi.advanceTimersByTime(16);
  expect(onOutput).toHaveBeenCalledOnce();
});

test("reduce una ráfaga PTY de 1.500 eventos a una actualización acotada", () => {
  vi.useFakeTimers();
  const onText = vi.fn();
  const batcher = createTerminalTextBatcher(onText, 16);
  let expected = "";

  for (let index = 0; index < 1_500; index += 1) {
    const fragment = `evento-${index}: ${"salida".repeat(8)}\n`;
    expected += fragment;
    batcher.push(fragment);
  }

  vi.advanceTimersByTime(16);

  expect(onText).toHaveBeenCalledTimes(1);
  expect(onText).toHaveBeenCalledWith(expected.slice(-24_000));
});

test("conserva el mismo sufijo al recortar fragmentos Unicode entre lotes", () => {
  vi.useFakeTimers();
  const onText = vi.fn();
  const batcher = createTerminalTextBatcher(onText, 16);
  const chunks = [`\ud83d\ude00${"x".repeat(23_999)}`, "y".repeat(4), "z"];
  const expected = chunks.reduce((output, chunk) => appendTerminalOutput(output, chunk), "");

  chunks.forEach(chunk => batcher.push(chunk));
  batcher.flush();

  expect(onText).toHaveBeenCalledWith(expected);
});

test("no devuelve un sustituto bajo aislado al recortar una ráfaga grande", () => {
  vi.useFakeTimers();
  const onText = vi.fn();
  const batcher = createTerminalTextBatcher(onText, 16);
  const chunk = `\ud83d\ude00${"x".repeat(23_999)}`;

  batcher.push(chunk);
  batcher.flush();

  expect(onText).toHaveBeenCalledWith(appendTerminalOutput("", chunk));
});

test("ignora fragmentos vacíos y el vaciado de una cola vacía", () => {
  vi.useFakeTimers();
  const onText = vi.fn();
  const batcher = createTerminalTextBatcher(onText, 16);

  batcher.push("");
  batcher.flush();
  vi.advanceTimersByTime(16);

  expect(onText).not.toHaveBeenCalled();
});

test("cancelar descarta la captura pendiente", () => {
  vi.useFakeTimers();
  const onText = vi.fn();
  const batcher = createTerminalTextBatcher(onText);
  batcher.cancel();
  batcher.push("pendiente");
  batcher.cancel();
  vi.advanceTimersByTime(16);
  expect(onText).not.toHaveBeenCalled();
});

test("solo solicita redimensionar cuando cambian filas o columnas válidas", () => {
  const initial = { rows: 28, cols: 100 };

  expect(terminalSizeChanged(initial, initial)).toBe(false);
  expect(terminalSizeChanged(initial, { rows: 29, cols: 100 })).toBe(true);
  expect(terminalSizeChanged(initial, { rows: 28, cols: 101 })).toBe(true);
  expect(terminalSizeChanged(initial, { rows: 0, cols: 100 })).toBe(false);
  expect(terminalSizeChanged(null, { rows: 28, cols: 100 })).toBe(true);
});

test("decodifica los bytes del PTY en Base64 y rechaza datos malformados", () => {
  expect([...decodeTerminalOutput("AAEC/w==") ?? []]).toEqual([0, 1, 2, 255]);
  expect(decodeTerminalOutput("AAEC/w==\n")).toBeNull();
  expect(decodeTerminalOutput("AAEC/w")).toBeNull();
  expect(decodeTerminalOutput("%%%invalid%%%")).toBeNull();
  expect(decodeTerminalOutput("A".repeat(44_000))).toBeNull();
});

test("acepta la salida máxima del PTY y rechaza un byte adicional", () => {
  expect(decodeTerminalOutput(btoa("x".repeat(32 * 1024)))).toHaveLength(32 * 1024);
  expect(decodeTerminalOutput(btoa("x".repeat(32 * 1024 + 1)))).toBeNull();
});

test("decodifica el mismo evento PTY que genera Rust según el fixture compartido", () => {
  const bytes = decodeTerminalOutput(fixture.dataBase64);

  expect(bytes).not.toBeNull();
  expect(new TextDecoder().decode(bytes!)).toBe("🌍");
});
