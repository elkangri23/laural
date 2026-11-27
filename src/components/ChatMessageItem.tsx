import { lazy, memo, Suspense, useEffect, useState } from "react";
import { SparkIcon } from "./SparkIcon";
import { useLanguage } from "../i18n";
import type { TerminalShell } from "../chatCommands";

const AssistantMarkdown = lazy(() => import("./AssistantMarkdown").then(module => ({ default: module.AssistantMarkdown })));

export type ChatMessage = { role: "user" | "assistant"; content: string; id?: string };
type StreamingContentRef = { current: { snapshot: () => string } | null };
const STREAM_MARKDOWN_REFRESH_MS = 200;

type ChatMessageItemProps = { message: ChatMessage; isStreaming?: boolean; streamingContentRef?: StreamingContentRef; terminalShell?: TerminalShell; onPrepareCommand?: (command: string) => void };

export const ChatMessageItem = memo(function ChatMessageItem({ message, isStreaming = false, streamingContentRef, terminalShell = "powershell", onPrepareCommand }: ChatMessageItemProps) {
  const { messages } = useLanguage();
  const [renderedStreamContent, setRenderedStreamContent] = useState(message.content);

  useEffect(() => {
    if (!isStreaming) return;
    const currentContent = () => streamingContentRef?.current?.snapshot() ?? message.content;
    setRenderedStreamContent(currentContent());
    const timer = window.setInterval(() => setRenderedStreamContent(currentContent()), STREAM_MARKDOWN_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [isStreaming, message.id, streamingContentRef]);

  useEffect(() => {
    if (isStreaming && renderedStreamContent.length === 0 && message.content.length > 0) {
      setRenderedStreamContent(message.content);
    }
  }, [isStreaming, message.content, renderedStreamContent.length]);

  const content = isStreaming ? renderedStreamContent : message.content;
  return <article className={`chat-message ${message.role}`}>
    <span className="message-avatar">{message.role === "user" ? messages.chat.user : <SparkIcon />}</span>
    <div className="message-content">{message.role === "assistant" ? <Suspense fallback={<span role="status">{messages.chat.preparing}</span>}><AssistantMarkdown content={content} shell={terminalShell} onPrepareCommand={isStreaming ? undefined : onPrepareCommand} /></Suspense> : message.content}</div>
  </article>;
}, (previous, next) => {
  if (previous.isStreaming && next.isStreaming && previous.message.id === next.message.id) {
    if (previous.message.content.length === 0 && next.message.content.length > 0) return false;
    return previous.streamingContentRef === next.streamingContentRef;
  }
  return previous.message === next.message && previous.isStreaming === next.isStreaming && previous.terminalShell === next.terminalShell && previous.onPrepareCommand === next.onPrepareCommand;
});
