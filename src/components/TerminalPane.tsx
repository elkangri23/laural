import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { terminalTheme, type AppearanceMode, type ThemeDefinition } from "../themes";
import "@xterm/xterm/css/xterm.css";

type Shell = "powershell" | "cmd" | "wsl" | "git-bash";
type OutputEvent = { terminalId: string; data: number[] };
type TerminalPaneProps = { terminalId: string; shell: Shell; cwd: string | null; visible: boolean; theme: ThemeDefinition; appearance: AppearanceMode; onTextOutput: (terminalId: string, text: string) => void; onCommandSubmit: (terminalId: string, command: string) => void; onCommandFinish: (terminalId: string, exitCode: number | null) => void };

function TerminalPane({ terminalId, shell, cwd, visible, theme, appearance, onTextOutput, onCommandSubmit, onCommandFinish }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const terminalRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "bar",
      fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.45,
      scrollback: 5000,
      theme: terminalTheme(theme, appearance),
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    terminalRef.current = terminal;
    fitRef.current = fitAddon;

    let disposed = false;
    let isReady = false;
    let writeQueue: Promise<void> = Promise.resolve();
    let unlistenOutput: (() => void) | undefined;
    const decoder = new TextDecoder();
    const commandOsc = terminal.parser.registerOscHandler(133, (payload) => {
      const [mark, rawCode] = payload.split(";", 2);
      if (mark === "D") {
        const parsed = rawCode === undefined ? null : Number.parseInt(rawCode, 10);
        onCommandFinish(terminalId, parsed !== null && Number.isFinite(parsed) ? parsed : null);
        return true;
      }
      return mark === "A" || mark === "B" || mark === "C";
    });
    const outputListener = listen<OutputEvent>("terminal-output", (event) => {
      if (event.payload.terminalId === terminalId) {
        const bytes = new Uint8Array(event.payload.data);
        terminal.write(bytes);
        onTextOutput(terminalId, decoder.decode(bytes, { stream: true }));
      }
    });
    let commandLine: string | null = "";
    let skipLineFeed = false;
    const inputSubscription = terminal.onData((data) => {
      if (data.includes("\u0003")) commandLine = "";
      if (data.startsWith("\u001b")) commandLine = null;
      else {
        for (const character of data) {
          if (character === "\r") {
            skipLineFeed = true;
            if (commandLine?.trim()) onCommandSubmit(terminalId, commandLine.trim());
            else if (commandLine === null) onCommandSubmit(terminalId, "Comando editado en el shell; texto no capturado");
            commandLine = "";
          } else if (character === "\n" && skipLineFeed) {
            skipLineFeed = false;
          } else if (character === "\n") {
            if (commandLine?.trim()) onCommandSubmit(terminalId, commandLine.trim());
            else if (commandLine === null) onCommandSubmit(terminalId, "Comando editado en el shell; texto no capturado");
            commandLine = "";
          } else if (character === "\u007f" || character === "\b") {
            if (commandLine && commandLine.length > 0) commandLine = commandLine.slice(0, -1);
          } else if (character >= " " && character !== "\u007f") {
            commandLine = commandLine === null ? null : commandLine + character;
          }
        }
      }
      if (!data.includes("\r") && !data.includes("\n")) skipLineFeed = false;
      if (isReady) {
        writeQueue = writeQueue.then(async () => {
          await invoke("write_terminal", { terminalId, data });
        }).catch((error) => {
          terminal.write(`\r\n\x1b[31mLaural: ${String(error)}\x1b[0m\r\n`);
        });
      }
    });
    const fitAndResize = () => {
      if (disposed || host.clientWidth === 0 || host.clientHeight === 0) return;
      try {
        fitAddon.fit();
        if (isReady) void invoke("resize_terminal", { terminalId, rows: terminal.rows, cols: terminal.cols }).catch(() => undefined);
      } catch {
        // The host may briefly have no layout while a split or tab is changing.
      }
    };
    const observer = new ResizeObserver(fitAndResize);
    observer.observe(host);
    void outputListener.then((unlisten) => {
      if (disposed) unlisten();
      else unlistenOutput = unlisten;
    });

    requestAnimationFrame(() => {
      fitAndResize();
      void invoke("create_terminal", { terminalId, shell, cwd, rows: terminal.rows || 28, cols: terminal.cols || 100 })
        .then(() => {
          if (disposed) return;
          isReady = true;
          fitAndResize();
          terminal.focus();
        })
        .catch((error) => { terminal.write(`\x1b[31mNo se pudo iniciar ${shell}: ${String(error)}\x1b[0m\r\n`); });
    });

    return () => {
      disposed = true;
      observer.disconnect();
      inputSubscription.dispose();
      commandOsc.dispose();
      unlistenOutput?.();
      void outputListener.then((unlisten) => unlisten());
      terminal.dispose();
      void invoke("close_terminal", { terminalId }).catch(() => undefined);
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [cwd, onCommandFinish, onCommandSubmit, onTextOutput, shell, terminalId]);

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.options.theme = terminalTheme(theme, appearance);
  }, [appearance, theme]);

  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => {
      try { fitRef.current?.fit(); terminalRef.current?.focus(); }
      catch { /* Hidden panels briefly have no measurable layout. */ }
    });
    return () => cancelAnimationFrame(frame);
  }, [visible]);

  return <div className={`terminal-pane ${visible ? "visible" : "hidden"}`} ref={hostRef} />;
}

export default TerminalPane;
