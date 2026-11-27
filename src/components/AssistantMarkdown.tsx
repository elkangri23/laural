import { Children, isValidElement, memo, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useLanguage } from "../i18n";
import { extractChatCommand, type TerminalShell } from "../chatCommands";

function SafeMarkdownLink({ node: _node, ...props }: React.ComponentProps<"a"> & { node?: unknown }) {
  return <a {...props} target="_blank" rel="noopener noreferrer" />;
}

function MarkdownImagePlaceholder({ alt }: { alt?: string }) {
  const { messages } = useLanguage();
  return <span className="markdown-image-placeholder">{alt ? `${messages.markdown.imageOmitted}: ${alt}` : messages.markdown.imageOmitted}</span>;
}

const components: Components = { a: SafeMarkdownLink, img: MarkdownImagePlaceholder };

function CommandCodeBlock({ children, shell, onPrepareCommand, buttonLabel }: {
  children?: ReactNode;
  shell: TerminalShell;
  onPrepareCommand?: (command: string) => void;
  buttonLabel: string;
}) {
  const code = Children.toArray(children).find(isValidElement);
  const codeProps = code?.props as { className?: string; children?: ReactNode } | undefined;
  const language = codeProps?.className?.match(/(?:^|\s)language-([\w+-]+)/)?.[1];
  const commandText = Children.toArray(codeProps?.children).join("");
  const command = extractChatCommand(language, commandText, shell);
  return <div className="markdown-code-block">
    <pre>{children}</pre>
    {command && onPrepareCommand && <button type="button" className="markdown-command-action" onClick={() => onPrepareCommand(command)}>{buttonLabel}</button>}
  </div>;
}

function safeUrlTransform(url: string) {
  if (url.startsWith("#")) return url;
  try {
    const protocol = new URL(url).protocol;
    return protocol === "https:" || protocol === "http:" || protocol === "mailto:" ? url : "";
  } catch {
    return "";
  }
}

export const AssistantMarkdown = memo(function AssistantMarkdown({ content, shell = "powershell", onPrepareCommand }: {
  content: string;
  shell?: TerminalShell;
  onPrepareCommand?: (command: string) => void;
}) {
  const { messages } = useLanguage();
  const markdownComponents: Components = {
    ...components,
    pre: ({ children }) => <CommandCodeBlock shell={shell} onPrepareCommand={onPrepareCommand} buttonLabel={messages.markdown.prepareInTerminal}>{children}</CommandCodeBlock>,
  };
  return <div className="markdown-content">
    <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents} urlTransform={safeUrlTransform}>
      {content}
    </Markdown>
  </div>;
});
