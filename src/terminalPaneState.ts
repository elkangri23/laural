import type { Terminal } from "@xterm/xterm";
import { terminalTheme, type AppearanceMode, type ThemeDefinition } from "./themes";

type TerminalView = Pick<Terminal, "options" | "getSelection">;

export function initializeWithTerminalHost(host: HTMLElement | null, initialize: (host: HTMLElement) => void | (() => void)): void | (() => void) {
  if (!host) return;
  return initialize(host);
}

export function applyTerminalTheme(terminal: TerminalView | null, theme: ThemeDefinition, appearance: AppearanceMode): void {
  if (!terminal) return;
  terminal.options.theme = terminalTheme(theme, appearance);
}

export function applyTerminalCursorBlink(terminal: TerminalView | null, visible: boolean, active: boolean): void {
  if (!terminal) return;
  terminal.options.cursorBlink = visible && active;
}

export function readTerminalSelection(terminal: TerminalView | null): string {
  return terminal?.getSelection() ?? "";
}
