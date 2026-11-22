import { lazy, memo, Suspense } from "react";
import { SparkIcon } from "./SparkIcon";

const AssistantMarkdown = lazy(() => import("./AssistantMarkdown").then(module => ({ default: module.AssistantMarkdown })));

export type ChatMessage = { role: "user" | "assistant"; content: string; id?: string };

export const ChatMessageItem = memo(function ChatMessageItem({ message }: { message: ChatMessage }) {
  return <article className={`chat-message ${message.role}`}>
    <span className="message-avatar">{message.role === "user" ? "Tú" : <SparkIcon />}</span>
    <div className="message-content">{message.role === "assistant" ? <Suspense fallback={<span role="status">Preparando respuesta…</span>}><AssistantMarkdown content={message.content} /></Suspense> : message.content}</div>
  </article>;
});
