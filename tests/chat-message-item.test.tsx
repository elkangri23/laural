// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { LanguageProvider } from "../src/i18n";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { ChatMessageItem, type ChatMessage } from "../src/components/ChatMessageItem";
import { createStreamingTextBuffer } from "../src/streamingText";

const mocks = vi.hoisted(() => ({ sparkIconRender: vi.fn() }));
vi.mock("../src/components/SparkIcon", () => ({ SparkIcon: () => { mocks.sparkIconRender(); return null; } }));
vi.mock("../src/components/AssistantMarkdown", () => ({ AssistantMarkdown: ({ content, shell, onPrepareCommand }: { content: string; shell?: string; onPrepareCommand?: (command: string) => void }) => <span className="test-markdown" data-shell={shell}>{content}{onPrepareCommand && <button onClick={() => onPrepareCommand("dir")}>preparar</button>}</span> }));

let root: Root | undefined;
let host: HTMLDivElement;

function renderWithLanguage(children: ReactNode) {
  localStorage.setItem("laural.language.v1", "es");
  return root!.render(<LanguageProvider>{children}</LanguageProvider>);
}

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

  await act(async () => renderWithLanguage(render([previousMessage, streamingMessage])));
  const rendersAfterInitialMount = mocks.sparkIconRender.mock.calls.length;
  mocks.sparkIconRender.mockClear();

  await act(async () => renderWithLanguage(render([previousMessage, { ...streamingMessage, content: "Segundo fragmento" }])));

  expect(mocks.sparkIconRender).toHaveBeenCalledTimes(1);
  expect(rendersAfterInitialMount).toBeGreaterThanOrEqual(2);
  expect(host.querySelectorAll(".chat-message")).toHaveLength(2);
});

test("limita a cinco por segundo el render Markdown mientras llega el streaming", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const message: ChatMessage = { id: "stream", role: "assistant", content: "fragmento 1" };
  const streamingContentRef = { current: createStreamingTextBuffer() };
  streamingContentRef.current.append("fragmento 1");

  await act(async () => renderWithLanguage(<ChatMessageItem message={message} isStreaming streamingContentRef={streamingContentRef} />));
  await act(async () => { await Promise.resolve(); });
  expect(host.textContent).toContain("fragmento 1");
  mocks.sparkIconRender.mockClear();

  streamingContentRef.current.clear();
  streamingContentRef.current.append("fragmento 2");
  await act(async () => renderWithLanguage(<ChatMessageItem message={{ ...message, content: "fragmento 2" }} isStreaming streamingContentRef={streamingContentRef} />));
  expect(host.textContent).toContain("fragmento 1");
  expect(mocks.sparkIconRender).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(199); });
  expect(host.textContent).toContain("fragmento 1");
  expect(mocks.sparkIconRender).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(host.textContent).toContain("fragmento 2");
  expect(mocks.sparkIconRender).toHaveBeenCalledTimes(1);

  await act(async () => renderWithLanguage(<ChatMessageItem message={{ ...message, content: "respuesta final" }} isStreaming={false} streamingContentRef={streamingContentRef} />));
  expect(host.textContent).toContain("respuesta final");
  expect(mocks.sparkIconRender).toHaveBeenCalledTimes(2);
});

test("pasa el shell activo y habilita preparación solo en mensajes finalizados", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const prepare = vi.fn();
  const message: ChatMessage = { id: "comando", role: "assistant", content: "```cmd\ndir\n```" };

  await act(async () => renderWithLanguage(<ChatMessageItem message={message} terminalShell="cmd" onPrepareCommand={prepare} />));
  expect(host.querySelector(".test-markdown")?.getAttribute("data-shell")).toBe("cmd");
  await act(async () => host.querySelector("button")?.click());
  expect(prepare).toHaveBeenCalledWith("dir");

  await act(async () => renderWithLanguage(<ChatMessageItem message={message} terminalShell="cmd" onPrepareCommand={prepare} isStreaming />));
  expect(host.querySelector("button")).toBeNull();
});
