import { memo } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useLanguage } from "../i18n";

function SafeMarkdownLink({ node: _node, ...props }: React.ComponentProps<"a"> & { node?: unknown }) {
  return <a {...props} target="_blank" rel="noopener noreferrer" />;
}

function MarkdownImagePlaceholder({ alt }: { alt?: string }) {
  const { messages } = useLanguage();
  return <span className="markdown-image-placeholder">{alt ? `${messages.markdown.imageOmitted}: ${alt}` : messages.markdown.imageOmitted}</span>;
}

const components: Components = { a: SafeMarkdownLink, img: MarkdownImagePlaceholder };

function safeUrlTransform(url: string) {
  if (url.startsWith("#")) return url;
  try {
    const protocol = new URL(url).protocol;
    return protocol === "https:" || protocol === "http:" || protocol === "mailto:" ? url : "";
  } catch {
    return "";
  }
}

export const AssistantMarkdown = memo(function AssistantMarkdown({ content }: { content: string }) {
  return <div className="markdown-content">
    <Markdown remarkPlugins={[remarkGfm]} components={components} urlTransform={safeUrlTransform}>
      {content}
    </Markdown>
  </div>;
});
