export type TerminalShell = "powershell" | "cmd" | "wsl" | "git-bash";

const SHELL_LANGUAGES: Record<TerminalShell, readonly string[]> = {
  powershell: ["powershell", "pwsh", "ps1"],
  cmd: ["cmd", "batch", "bat"],
  wsl: ["bash", "sh", "shell"],
  "git-bash": ["bash", "sh", "shell"],
};

export function extractChatCommand(language: string | undefined, source: string, shell: TerminalShell): string | null {
  if (!language || !SHELL_LANGUAGES[shell].includes(language.trim().toLowerCase())) return null;
  const command = source.trim();
  if (!command || command.length > 4_000 || /[\r\n\u2028\u2029\u0000-\u001f\u007f]/.test(command)) return null;
  return command;
}
