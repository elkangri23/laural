import { lazy, memo, Suspense, useEffect, useRef, useState } from "react";
import { SparkIcon } from "./SparkIcon";

const AssistantMarkdown = lazy(() => import("./AssistantMarkdown").then(module => ({ default: module.AssistantMarkdown })));

export type ChatMessage = { role: "user" | "assistant"; content: string; id?: string };
const STREAM_MARKDOWN_REFRESH_MS = 200;

export const ChatMessageItem = memo(function ChatMessageItem({ message, isStreaming = false }: { message: ChatMessage; isStreaming?: boolean }) {
  const [renderedStreamContent, setRenderedStreamContent] = useState(message.content);
  const latestContent = useRef(message.content);
  latestContent.current = message.content;

  useEffect(() => {
    if (!isStreaming) return;
    setRenderedStreamContent(message.content);
    const timer = window.setInterval(() => setRenderedStreamContent(latestContent.current), STREAM_MARKDOWN_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [isStreaming, message.id]);

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
});
