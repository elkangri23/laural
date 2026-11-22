import { memo } from "react";

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
  const output = cleanOutput(block.output).trim();
  return <details className="command-block">
    <summary><span className="block-status-dot" data-status={block.status} /><code>{block.command}</code><span className="block-exit">{block.status === "running" ? "En curso" : block.exitCode === null ? "Finalizado" : `Salida ${block.exitCode}`}</span></summary>
    <pre>{output || "Sin salida capturada."}</pre>
  </details>;
});
