import { expect, test } from "vitest";
import { prepareChatHistoryForRequest } from "../src/chatHistory";

test("prepara solo los últimos veinte mensajes y conserva su orden", () => {
  const messages = Array.from({ length: 25 }, (_, index) => ({
    role: index % 2 === 0 ? "user" as const : "assistant" as const,
    content: String(index),
  }));

  const requestHistory = prepareChatHistoryForRequest(messages);

  expect(requestHistory).toHaveLength(20);
  expect(requestHistory[0]?.content).toBe("5");
  expect(requestHistory.at(-1)?.content).toBe("24");
});

test("recorta por puntos de código Unicode sin partir el último carácter", () => {
  const content = `${"a".repeat(7_999)}📁z`;
  const [message] = prepareChatHistoryForRequest([{ role: "assistant", content }]);

  expect(Array.from(message!.content)).toHaveLength(8_000);
  expect(message!.content.endsWith("📁")).toBe(true);
  expect(message!.content.endsWith("\ud83d")).toBe(false);
});

test("no modifica el contenido que ya cabe en el límite", () => {
  const message = { role: "user" as const, content: "pregunta breve" };

  expect(prepareChatHistoryForRequest([message])).toEqual([message]);
});
