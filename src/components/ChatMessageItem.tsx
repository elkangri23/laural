import { lazy, memo, Suspense, useEffect, useState } from "react";
import { SparkIcon } from "./SparkIcon";

const AssistantMarkdown = lazy(() => import("./AssistantMarkdown").then(module => ({ default: module.AssistantMarkdown })));

export type ChatMessage = { role: "user" | "assistant"; content: string; id?: string };
type StreamingContentRef = { current: { snapshot: () => string } | null };
const STREAM_MARKDOWN_REFRESH_MS = 200;

type ChatMessageItemProps = { message: ChatMessage; isStreaming?: boolean; streamingContentRef?: StreamingContentRef };

export const ChatMessageItem = memo(function ChatMessageItem({ message, isStreaming = false, streamingContentRef }: ChatMessageItemProps) {
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
    <span className="message-avatar">{message.role === "user" ? "Tú" : <SparkIcon />}</span>
    <div className="message-content">{message.role === "assistant" ? <Suspense fallback={<span role="status">Preparando respuesta…</span>}><AssistantMarkdown content={content} /></Suspense> : message.content}</div>
  </article>;
}, (previous, next) => {
  if (previous.isStreaming && next.isStreaming && previous.message.id === next.message.id) {
    if (previous.message.content.length === 0 && next.message.content.length > 0) return false;
    return previous.streamingContentRef === next.streamingContentRef;
  }
  return previous.message === next.message && previous.isStreaming === next.isStreaming;
});
