import { afterEach, expect, test, vi } from "vitest";
import { createChatHistoryPersistence } from "../src/chatPersistence";

afterEach(() => vi.useRealTimers());

test("agrupa escrituras y persiste el snapshot más reciente cada 500 ms", () => {
  vi.useFakeTimers();
  const setItem = vi.fn();
  const persistence = createChatHistoryPersistence({ setItem });

  persistence.schedule([{ role: "assistant", content: "primer fragmento" }]);
  vi.advanceTimersByTime(250);
  persistence.schedule([{ role: "assistant", content: "respuesta completa" }]);
  vi.advanceTimersByTime(249);
  expect(setItem).not.toHaveBeenCalled();

  vi.advanceTimersByTime(1);
  expect(setItem).toHaveBeenCalledTimes(1);
  expect(setItem).toHaveBeenCalledWith("laural.chat.v1", JSON.stringify([
    { role: "assistant", content: "respuesta completa" },
  ]));
});

test("mantiene los límites actuales de mensajes e ignora fallos del almacenamiento", () => {
  vi.useFakeTimers();
  const setItem = vi.fn();
  const persistence = createChatHistoryPersistence({ setItem });
  const messages = Array.from({ length: 102 }, (_, index) => ({ role: "user" as const, content: `${index}: ${"x".repeat(20_001)}` }));

  persistence.schedule(messages);
  vi.advanceTimersByTime(500);
  const saved = JSON.parse(setItem.mock.calls[0]?.[1] as string) as Array<{ role: string; content: string }>;
  expect(saved).toHaveLength(100);
  expect(saved[0]?.content.startsWith("2: ")).toBe(true);
  expect(saved[0]?.content).toHaveLength(20_000);

  const failing = createChatHistoryPersistence({ setItem: () => { throw new Error("storage full"); } });
  expect(() => {
    failing.schedule([{ role: "user", content: "seguir disponible" }]);
    vi.advanceTimersByTime(500);
  }).not.toThrow();
});

test("flush escribe inmediatamente y cancel descarta el trabajo pendiente", () => {
  vi.useFakeTimers();
  const setItem = vi.fn();
  const persistence = createChatHistoryPersistence({ setItem });
  persistence.flush();
  expect(setItem).not.toHaveBeenCalled();
  persistence.schedule([{ role: "user", content: "guardar ya" }]);
  persistence.flush();
  expect(setItem).toHaveBeenCalledTimes(1);

  persistence.schedule([{ role: "user", content: "descartar" }]);
  persistence.cancel();
  persistence.cancel();
  persistence.flush();
  vi.advanceTimersByTime(500);
  expect(setItem).toHaveBeenCalledTimes(1);
});
