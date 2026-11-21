import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  a({ node: _node, ...props }) {
    return <a {...props} target="_blank" rel="noopener noreferrer" />;
  },
  img({ alt }) {
    return <span className="markdown-image-placeholder">{alt ? `Imagen omitida: ${alt}` : "Imagen omitida"}</span>;
  },
};

function safeUrlTransform(url: string) {
  if (url.startsWith("#")) return url;
  try {
    const protocol = new URL(url).protocol;
    return protocol === "https:" || protocol === "http:" || protocol === "mailto:" ? url : "";
  } catch {
    return "";
  }
}

export function AssistantMarkdown({ content }: { content: string }) {
  return <div className="markdown-content">
    <Markdown remarkPlugins={[remarkGfm]} components={components} urlTransform={safeUrlTransform}>
      {content}
    </Markdown>
  </div>;
}
