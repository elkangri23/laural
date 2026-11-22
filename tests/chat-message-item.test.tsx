// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { ChatMessageItem, type ChatMessage } from "../src/components/ChatMessageItem";

const mocks = vi.hoisted(() => ({ sparkIconRender: vi.fn() }));
vi.mock("../src/components/SparkIcon", () => ({ SparkIcon: () => { mocks.sparkIconRender(); return null; } }));

let root: Root | undefined;
let host: HTMLDivElement;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  host.remove();
  vi.unstubAllGlobals();
});

test("no vuelve a renderizar mensajes cuya identidad no cambió durante el streaming", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const previousMessage: ChatMessage = { id: "anterior", role: "assistant", content: "Respuesta anterior" };
  const streamingMessage: ChatMessage = { id: "actual", role: "assistant", content: "Primer fragmento" };
  const render = (messages: ChatMessage[]) => messages.map(message => <ChatMessageItem key={message.id} message={message} />);

  await act(async () => root!.render(render([previousMessage, streamingMessage])));
  const rendersAfterInitialMount = mocks.sparkIconRender.mock.calls.length;
  mocks.sparkIconRender.mockClear();

  await act(async () => root!.render(render([previousMessage, { ...streamingMessage, content: "Segundo fragmento" }])));

  expect(mocks.sparkIconRender).toHaveBeenCalledTimes(1);
  expect(rendersAfterInitialMount).toBeGreaterThanOrEqual(2);
  expect(host.querySelectorAll(".chat-message")).toHaveLength(2);
});
