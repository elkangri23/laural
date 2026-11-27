import { memo, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { terminalTheme, type AppearanceMode, type ThemeDefinition } from "../themes";
import { applyTerminalCursorBlink, applyTerminalTheme, initializeWithTerminalHost, readTerminalSelection } from "../terminalPaneState";
import { createTerminalOutputBatcher, createTerminalTextBatcher, decodeTerminalOutput, terminalSizeChanged, type TerminalSize } from "../terminalOutput";
import { useLanguage } from "../i18n";
import type { TerminalShell } from "../chatCommands";
import "@xterm/xterm/css/xterm.css";

const TERMINAL_SCROLLBACK_LINES = 2_500;
const UNTRACKED_LINE_EDIT_KEYS = /[\u0001-\u0002\u0004-\u0007\u0009\u000b\u000c\u000e-\u001f]/;
type OutputEvent = { dataBase64: string };
type TerminalRequest = { sequence: number; terminalId: string };
type InsertRequest = TerminalRequest & { command: string };
type TerminalPaneProps = { terminalId: string; shell: TerminalShell; cwd: string | null; powerShellPredictionEnabled: boolean; visible: boolean; active: boolean; copyRequest: TerminalRequest; clearRequest: TerminalRequest; insertRequest: InsertRequest; onActionNotice: (message: string) => void; onRestart: (terminalId: string) => void; theme: ThemeDefinition; appearance: AppearanceMode; onTextOutput: (terminalId: string, text: string) => void; onCommandSubmit: (terminalId: string, command: string) => void; onCommandFinish: (terminalId: string, exitCode: number | null) => void; onAgentCommandFinish: (terminalId: string, token: string, exitCode: number | null) => void };

function TerminalPane({ terminalId, shell, cwd, powerShellPredictionEnabled, visible, active, copyRequest, clearRequest, insertRequest, onActionNotice, onRestart, theme, appearance, onTextOutput, onCommandSubmit, onCommandFinish, onAgentCommandFinish }: TerminalPaneProps) {
  const { messages } = useLanguage();
  const terminalText = messages.terminal;
  const [ended, setEnded] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const handledCopyRef = useRef(0);
  const handledClearRef = useRef(0);
  const handledInsertRef = useRef(0);
  const insertHandlerRef = useRef<(command: string) => Promise<void>>(async () => {
    onActionNotice(terminalText.commandInsertFailed);
  });

  useEffect(() => initializeWithTerminalHost(hostRef.current, (host) => {
    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: visible && active,
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
    let lastSentSize: TerminalSize | null = null;
    const subscriptions: (() => void)[] = [];
    const decoder = new TextDecoder();
    const textBatcher = createTerminalTextBatcher((text) => onTextOutput(terminalId, text));
    const outputBatcher = createTerminalOutputBatcher((bytes) => {
      terminal.write(bytes, () => {
        void invoke("ack_terminal_output", { terminalId, bytes: bytes.byteLength }).catch(() => undefined);
      });
      textBatcher.push(decoder.decode(bytes, { stream: true }));
      textBatcher.flush();
    });
    const commandOsc = terminal.parser.registerOscHandler(133, (payload) => {
      const [mark, rawCode] = payload.split(";", 2);
      if (mark === "D") {
        const parsed = rawCode === undefined ? null : Number.parseInt(rawCode, 10);
        onCommandFinish(terminalId, parsed !== null && Number.isFinite(parsed) ? parsed : null);
        commandRunning = false;
        return true;
      }
      return mark === "A" || mark === "B" || mark === "C";
    });
    const agentCommandOsc = terminal.parser.registerOscHandler(777, (payload) => {
      const [token, rawCode] = payload.split(";", 2);
      if (!token || !rawCode || !/^\d{1,10}$/.test(rawCode)) return true;
      onAgentCommandFinish(terminalId, token, Number(rawCode));
      return true;
    });
    let commandRunning = false;
    let insertionPending = false;
    const onOutput = (event: { payload: OutputEvent }) => {
      if (!disposed) {
        const bytes = decodeTerminalOutput(event.payload.dataBase64);
        if (!bytes) return;
        outputBatcher.push(bytes);
      }
    };
    let commandLine: string | null = "";
    insertHandlerRef.current = async (command) => {
      if (!command.trim() || command.length > 4_000 || /[\r\n\u2028\u2029\u0000-\u001f\u007f]/.test(command)) {
        onActionNotice(terminalText.commandInsertFailed);
        return;
      }
      if (commandRunning || insertionPending) {
        onActionNotice(terminalText.terminalBusy);
        return;
      }
      if (!isReady || disposed || exited) {
        onActionNotice(terminalText.commandInsertFailed);
        return;
      }
      if (commandLine !== "") {
        onActionNotice(terminalText.commandLineNotEmpty);
        return;
      }
      insertionPending = true;
      commandLine = command;
      writeQueue = writeQueue.then(async () => {
        await startup;
        if (!isReady || disposed || exited) throw new Error("Terminal is unavailable");
        await invoke("write_terminal", { terminalId, data: command });
      }).then(() => {
        if (!disposed) onActionNotice(terminalText.commandPrepared);
      }).catch(() => {
        commandLine = null;
        if (!disposed) onActionNotice(terminalText.commandInsertFailed);
      }).finally(() => { insertionPending = false; });
      await writeQueue;
    };
    let skipLineFeed = false;
    const inputSubscription = terminal.onData((data) => {
      if (disposed || exited) return;
      if (data.includes("\u0003")) commandLine = "";
      else if (data.includes("\u001b") || UNTRACKED_LINE_EDIT_KEYS.test(data)) commandLine = null;
      for (const character of data) {
        if (character === "\r") {
          skipLineFeed = true;
          if (commandLine?.trim()) { onCommandSubmit(terminalId, commandLine.trim()); commandRunning = true; }
          else if (commandLine === null) { onCommandSubmit(terminalId, terminalText.editedCommandNotCaptured); commandRunning = true; }
          commandLine = "";
        } else if (character === "\n" && skipLineFeed) {
          skipLineFeed = false;
        } else if (character === "\n") {
          if (commandLine?.trim()) { onCommandSubmit(terminalId, commandLine.trim()); commandRunning = true; }
          else if (commandLine === null) { onCommandSubmit(terminalId, terminalText.editedCommandNotCaptured); commandRunning = true; }
          commandLine = "";
        } else if (character === "\u007f" || character === "\b") {
          if (commandLine && commandLine.length > 0) commandLine = commandLine.slice(0, -1);
        } else if (character >= " " && character !== "\u007f") {
          commandLine = commandLine === null ? null : commandLine + character;
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
        const size = { rows: terminal.rows, cols: terminal.cols };
        if (isReady && terminalSizeChanged(lastSentSize, size)) {
          lastSentSize = size;
          void invoke("resize_terminal", { terminalId, ...size }).catch(() => undefined);
        }
      } catch {
        // The host may briefly have no layout while a split or tab is changing.
      }
    };
    const observer = new ResizeObserver(fitAndResize);
    observer.observe(host);
    async function start() {
      const output = await listen<OutputEvent>(`terminal-output-${terminalId}`, onOutput);
      if (disposed) { output(); return; }
      subscriptions.push(output);
      const exit = await listen<void>(`terminal-exit-${terminalId}`, () => {
        if (disposed) return;
        outputBatcher.flush();
        textBatcher.push(decoder.decode());
        textBatcher.flush();
        exited = true;
        isReady = false;
        setEnded(true);
        onCommandFinish(terminalId, null);
      });
      if (disposed) { exit(); return; }
      subscriptions.push(exit);
      fitAndResize();
      started = true;
      const initialSize = { rows: terminal.rows || 28, cols: terminal.cols || 100 };
      // Captura la preferencia al iniciar; cambiarla aplica solo a nuevas sesiones.
      await invoke("create_terminal", { terminalId, shell, cwd, powerShellPredictionEnabled: shell === "powershell" && powerShellPredictionEnabled, ...initialSize });
      if (disposed || exited) return;
      lastSentSize = initialSize;
      isReady = true;
      fitAndResize();
    }

    const startup = start().catch((error) => {
      if (disposed) return;
      terminal.writeln(`${terminalText.startFailure} ${shell}: ${String(error)}`);
      setEnded(true);
    });
    return () => {
      disposed = true;
      outputBatcher.flush();
      textBatcher.push(decoder.decode());
      textBatcher.flush();
      observer.disconnect();
      inputSubscription.dispose();
      commandOsc.dispose();
      agentCommandOsc.dispose();
      subscriptions.forEach(unlisten => unlisten());
      terminal.dispose();
      void startup.then(() => {
        if (started) return invoke("close_terminal", { terminalId });
      }).catch(() => undefined);
      terminalRef.current = null;
      fitRef.current = null;
    };
  }), [cwd, onCommandFinish, onCommandSubmit, onTextOutput, shell, terminalId]);

  useEffect(() => {
    applyTerminalTheme(terminalRef.current, theme, appearance);
  }, [appearance, theme]);

  useEffect(() => {
    applyTerminalCursorBlink(terminalRef.current, visible, active);
  }, [active, visible]);

  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => {
      try { fitRef.current?.fit(); if (active) terminalRef.current?.focus(); }
      catch { /* Hidden panels briefly have no measurable layout. */ }
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, active]);

  useEffect(() => {
    if (copyRequest.sequence === 0 || copyRequest.sequence === handledCopyRef.current) return;
    handledCopyRef.current = copyRequest.sequence;
    if (copyRequest.terminalId !== terminalId) return;
    const selection = readTerminalSelection(terminalRef.current);
    if (!selection) {
      onActionNotice(terminalText.selectToCopy);
      return;
    }
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      void navigator.clipboard.writeText(selection).then(
        () => onActionNotice(terminalText.copied),
        () => onActionNotice(terminalText.clipboardDenied),
      );
    } catch {
      onActionNotice(terminalText.clipboardDenied);
    }
  }, [copyRequest, onActionNotice, terminalId, terminalText.clipboardDenied, terminalText.copied, terminalText.selectToCopy]);

  useEffect(() => {
    if (clearRequest.sequence === 0 || clearRequest.sequence === handledClearRef.current) return;
    handledClearRef.current = clearRequest.sequence;
    if (clearRequest.terminalId !== terminalId) return;
    terminalRef.current?.clear();
    onActionNotice(terminalText.screenCleared);
  }, [clearRequest, onActionNotice, terminalId, terminalText.screenCleared]);

  useEffect(() => {
    if (insertRequest.sequence === 0 || insertRequest.sequence === handledInsertRef.current) return;
    handledInsertRef.current = insertRequest.sequence;
    if (insertRequest.terminalId !== terminalId) return;
    void insertHandlerRef.current(insertRequest.command);
  }, [insertRequest, onActionNotice, terminalId, terminalText.commandInsertFailed]);

  return <div className={`terminal-pane ${visible ? "visible" : "hidden"}`} ><div className="terminal-host" ref={hostRef} />
    {ended && <div className="terminal-ended" role="status">{terminalText.sessionEnded} <button onClick={() => onRestart(terminalId)}>{terminalText.restart}</button></div>}
  </div>;
}

export default memo(TerminalPane);
