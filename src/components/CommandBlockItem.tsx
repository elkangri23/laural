import { memo } from "react";
import { useLanguage } from "../i18n";

export type CommandBlock = {
  id: string;
  terminalId: string;
  command: string;
  output: string;
  status: "running" | "finished";
  exitCode: number | null;
};

function cleanOutput(output: string) {
  return output
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

export const CommandBlockItem = memo(function CommandBlockItem({ block }: { block: CommandBlock }) {
  const { messages } = useLanguage();
  const output = cleanOutput(block.output).trim();
  return <details className="command-block">
    <summary><span className="block-status-dot" data-status={block.status} /><code>{block.command}</code><span className="block-exit">{block.status === "running" ? messages.commandBlock.running : block.exitCode === null ? messages.commandBlock.finished : messages.commandBlock.exit.replace("{code}", String(block.exitCode))}</span></summary>
    <pre>{output || messages.commandBlock.empty}</pre>
  </details>;
});
