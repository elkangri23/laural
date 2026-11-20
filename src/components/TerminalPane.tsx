import { memo, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { terminalTheme, type AppearanceMode, type ThemeDefinition } from "../themes";
import "@xterm/xterm/css/xterm.css";

type Shell = "powershell" | "cmd" | "wsl" | "git-bash";
const TERMINAL_SCROLLBACK_LINES = 2_500;
type OutputEvent = { terminalId: string; data: number[] };
type TerminalPaneProps = { terminalId: string; shell: Shell; cwd: string | null; visible: boolean; active: boolean; onRestart: (terminalId: string) => void; theme: ThemeDefinition; appearance: AppearanceMode; onTextOutput: (terminalId: string, text: string) => void; onCommandSubmit: (terminalId: string, command: string) => void; onCommandFinish: (terminalId: string, exitCode: number | null) => void };

function TerminalPane({ terminalId, shell, cwd, visible, active, onRestart, theme, appearance, onTextOutput, onCommandSubmit, onCommandFinish }: TerminalPaneProps) {
  const [ended, setEnded] = useState(false);
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
      scrollback: TERMINAL_SCROLLBACK_LINES,
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
    let started = false;
    let exited = false;
    const subscriptions: (() => void)[] = [];
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
    const onOutput = (event: { payload: OutputEvent }) => {
      if (!disposed && event.payload.terminalId === terminalId) {
        const bytes = new Uint8Array(event.payload.data);
        terminal.write(bytes);
        onTextOutput(terminalId, decoder.decode(bytes, { stream: true }));
      }
    };
    let commandLine: string | null = "";
    let skipLineFeed = false;
    const inputSubscription = terminal.onData((data) => {
      if (disposed || exited) return;
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
      writeQueue = writeQueue.then(async () => {
        await startup;
        if (!isReady || disposed || exited) return;
        await invoke("write_terminal", { terminalId, data });
      }).catch((error) => {
        if (!disposed) terminal.write(`\r\n\x1b[31mLaural: ${String(error)}\x1b[0m\r\n`);
      });
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
    async function start() {
      const output = await listen<OutputEvent>("terminal-output", onOutput);
      if (disposed) { output(); return; }
      subscriptions.push(output);
      const exit = await listen<string>("terminal-exit", ({ payload }) => {
        if (disposed || payload !== terminalId) return;
        exited = true;
        isReady = false;
        setEnded(true);
        onCommandFinish(terminalId, null);
      });
      if (disposed) { exit(); return; }
      subscriptions.push(exit);
      fitAndResize();
      started = true;
      await invoke("create_terminal", { terminalId, shell, cwd, rows: terminal.rows || 28, cols: terminal.cols || 100 });
      if (disposed || exited) return;
      isReady = true;
      fitAndResize();
    }

    const startup = start().catch((error) => {
      if (disposed) return;
      terminal.writeln(`No se pudo iniciar ${shell}: ${String(error)}`);
      setEnded(true);
    });
    return () => {
      disposed = true;
      observer.disconnect();
      inputSubscription.dispose();
      commandOsc.dispose();
      subscriptions.forEach(unlisten => unlisten());
      terminal.dispose();
      void startup.then(() => {
        if (started) return invoke("close_terminal", { terminalId });
      }).catch(() => undefined);
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
      try { fitRef.current?.fit(); if (active) terminalRef.current?.focus(); }
      catch { /* Hidden panels briefly have no measurable layout. */ }
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, active]);

  return <div className={`terminal-pane ${visible ? "visible" : "hidden"}`} ><div className="terminal-host" ref={hostRef} />
    {ended && <div className="terminal-ended" role="status">Sesión finalizada <button onClick={() => onRestart(terminalId)}>Reiniciar terminal</button></div>}
  </div>;
}

export default memo(TerminalPane);
