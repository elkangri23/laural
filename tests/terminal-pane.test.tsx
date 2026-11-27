// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import TerminalPane from "../src/components/TerminalPane";
import { themes } from "../src/themes";
import { LanguageProvider } from "../src/i18n";

const { invoke, listen, write, onData, registerOscHandler, terminalOptions, clear, getSelection, observeResize, terminalSize, fitAddonFit } = vi.hoisted(() => ({
  invoke: vi.fn(), listen: vi.fn(), write: vi.fn(), onData: vi.fn(), registerOscHandler: vi.fn(), terminalOptions: vi.fn(), clear: vi.fn(), getSelection: vi.fn(), observeResize: vi.fn<(callback: () => void) => void>(), terminalSize: { rows: 28, cols: 100 }, fitAddonFit: vi.fn<() => void>(),
}));
const { skipTerminalInitialization } = vi.hoisted(() => ({ skipTerminalInitialization: { value: false } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));
vi.mock("../src/terminalPaneState", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/terminalPaneState")>();
  return {
    ...original,
    initializeWithTerminalHost: (host: HTMLElement | null, initialize: (host: HTMLElement) => void | (() => void)) => {
      if (skipTerminalInitialization.value) return;
      return original.initializeWithTerminalHost(host, initialize);
    },
  };
});
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit = fitAddonFit; } }));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options: { cursorBlink?: boolean; theme?: unknown } = {}; parser = { registerOscHandler };
    get rows() { return terminalSize.rows; } get cols() { return terminalSize.cols; }
    constructor(options: { cursorBlink?: boolean; theme?: unknown }) { this.options = options; terminalOptions(options); }
    write = write; writeln = write;
    loadAddon() {} open() {} focus() {} dispose() {}
    clear = clear; getSelection = getSelection;
    onData = onData;
  },
}));

let root: Root | undefined;
let host: HTMLDivElement;
const finished = vi.fn(), agentFinished = vi.fn(), restart = vi.fn(), output = vi.fn(), submit = vi.fn();
const actionNotice = vi.fn();
const handlers = new Map<string, (event: { payload: unknown }) => void>();
const removeOutput = vi.fn(), removeExit = vi.fn();
function pane(visible = true, copyRequest = { sequence: 0, terminalId: "" }, clearRequest = { sequence: 0, terminalId: "" }, onActionNotice = actionNotice, shell: "powershell" | "cmd" | "wsl" | "git-bash" = "cmd", powerShellPredictionEnabled = false, insertRequest = { sequence: 0, terminalId: "", command: "" }) {
  return <LanguageProvider><TerminalPane terminalId="uno" shell={shell} cwd={null} powerShellPredictionEnabled={powerShellPredictionEnabled} visible={visible} active={visible}
    copyRequest={copyRequest} clearRequest={clearRequest} insertRequest={insertRequest} onActionNotice={onActionNotice}
    appearance="dark" theme={themes[0]} onCommandFinish={finished} onAgentCommandFinish={agentFinished} onRestart={restart}
    onTextOutput={output} onCommandSubmit={submit} /></LanguageProvider>;
}
const outputEvent = (data: number[]) => ({ payload: { dataBase64: btoa(String.fromCharCode(...data)) } });
beforeEach(() => {
  skipTerminalInitialization.value = false;
  localStorage.setItem("laural.language.v1", "es");
  vi.resetAllMocks();
  terminalSize.rows = 28;
  terminalSize.cols = 100;
  handlers.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { observeResize(callback); } observe() {} disconnect() {} });
  host = document.createElement("div");
  root = createRoot(host);
  listen.mockImplementation(async (name, fn) => {
    handlers.set(name, fn);
    return name === "terminal-output-uno" ? removeOutput : removeExit;
  });
  onData.mockReturnValue({ dispose() {} });
  registerOscHandler.mockReturnValue({ dispose() {} });
  invoke.mockResolvedValue(undefined);
  write.mockImplementation((_data, callback) => callback?.());
});
async function unmount() {
  await act(async () => root?.unmount());
  root = undefined;
}
afterEach(async () => { await unmount(); vi.unstubAllGlobals(); });

test("no repite el IPC de resize con el tamaño usado al crear la terminal", async () => {
  const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 800 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });

  try {
    await act(async () => root!.render(pane()));
    expect(invoke.mock.calls.map(([name]) => name)).toEqual(["create_terminal"]);
  } finally {
    await unmount();
    if (width) Object.defineProperty(HTMLElement.prototype, "clientWidth", width);
    else delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    if (height) Object.defineProperty(HTMLElement.prototype, "clientHeight", height);
    else delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  }
});

test("localiza los avisos de terminal al inglés sin modificar el shell", async () => {
  localStorage.setItem("laural.language.v1", "en");
  const clearRequest = { sequence: 1, terminalId: "uno" };
  await act(async () => root!.render(pane(true, { sequence: 0, terminalId: "" }, clearRequest)));
  expect(invoke).toHaveBeenCalledWith("create_terminal", expect.objectContaining({ shell: "cmd" }));
  expect(actionNotice).toHaveBeenCalledWith("Terminal screen cleared.");

  const input = onData.mock.calls[0][0];
  await act(async () => {
    input("original command");
    input("\x1b[A");
    input("edited command\r");
  });
  expect(submit).toHaveBeenCalledWith("uno", "Shell command edited; command text not captured");

  await act(async () => handlers.get("terminal-exit-uno")!({ payload: undefined }));
  expect(host.textContent).toContain("Session ended");
  expect(host.textContent).toContain("Restart terminal");
});

test("reconoce solo marcas numéricas OSC 777 del agente CMD", async () => {
  await act(async () => root!.render(pane()));
  const handler = registerOscHandler.mock.calls.find(([code]) => code === 777)?.[1] as ((payload: string) => boolean) | undefined;
  expect(handler).toBeDefined();
  expect(handler!("550e8400-e29b-41d4-a716-446655440000;%ERRORLEVEL%")).toBe(true);
  expect(handler!("550e8400-e29b-41d4-a716-446655440000;0extra")).toBe(true);
  expect(agentFinished).not.toHaveBeenCalled();

  await act(async () => handler!("550e8400-e29b-41d4-a716-446655440000;7"));
  expect(agentFinished).toHaveBeenCalledWith("uno", "550e8400-e29b-41d4-a716-446655440000", 7);
});

test("redimensiona el PTY si cambia el tamaño después del arranque", async () => {
  const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, value: 800 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
  try {
    await act(async () => root!.render(pane()));
    const resize = observeResize.mock.calls[0]?.[0];
    expect(resize).toBeDefined();
    terminalSize.rows = 32;
    terminalSize.cols = 120;
    await act(async () => resize?.());
    expect(invoke).toHaveBeenCalledWith("resize_terminal", { terminalId: "uno", rows: 32, cols: 120 });
  } finally {
    await unmount();
    if (width) Object.defineProperty(HTMLElement.prototype, "clientWidth", width);
    else delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    if (height) Object.defineProperty(HTMLElement.prototype, "clientHeight", height);
    else delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  }
});

test("tolera el error de layout temporal de xterm", async () => {
  fitAddonFit.mockImplementationOnce(() => { throw new Error("layout not ready"); });
  await act(async () => root!.render(pane()));
  await act(async () => new Promise(resolve => setTimeout(resolve, 20)));

  expect(host.querySelector(".terminal-pane")).not.toBeNull();
});

test("usa el tamaño base cuando xterm aún no informa filas ni columnas", async () => {
  terminalSize.rows = 0;
  terminalSize.cols = 0;
  await act(async () => root!.render(pane()));

  expect(invoke).toHaveBeenCalledWith("create_terminal", expect.objectContaining({ rows: 28, cols: 100 }));
});

test("pasa predicción solo a una sesión PowerShell nueva y no reinicia la sesión activa", async () => {
  await act(async () => root!.render(pane(true, undefined, undefined, actionNotice, "powershell", false)));
  expect(invoke).toHaveBeenCalledWith("create_terminal", expect.objectContaining({ shell: "powershell", powerShellPredictionEnabled: false }));

  await act(async () => root!.render(pane(true, undefined, undefined, actionNotice, "powershell", true)));
  expect(invoke.mock.calls.filter(([command]) => command === "create_terminal")).toHaveLength(1);

  await act(async () => root!.unmount());
  root = createRoot(host);
  invoke.mockClear();
  await act(async () => root!.render(pane(true, undefined, undefined, actionNotice, "powershell", true)));
  expect(invoke).toHaveBeenCalledWith("create_terminal", expect.objectContaining({ shell: "powershell", powerShellPredictionEnabled: true }));

  await act(async () => root!.unmount());
  root = createRoot(host);
  invoke.mockClear();
  await act(async () => root!.render(pane(true, undefined, undefined, actionNotice, "cmd", true)));
  expect(invoke).toHaveBeenCalledWith("create_terminal", expect.objectContaining({ shell: "cmd", powerShellPredictionEnabled: false }));
});

test("ocultar la pestaña conserva el proceso y su salida; salir permite reiniciar", async () => {
  await act(async () => root!.render(pane()));
  await act(async () => root!.render(pane(false)));
  handlers.get("terminal-output-uno")!(outputEvent([65]));
  handlers.get("terminal-output-uno")!(outputEvent([66]));
  expect(write).not.toHaveBeenCalled();
  expect(output).not.toHaveBeenCalled();
  await act(async () => new Promise((resolve) => window.setTimeout(resolve, 20)));
  expect(write).toHaveBeenCalledOnce();
  expect(Array.from(write.mock.calls[0][0] as Uint8Array)).toEqual([65, 66]);
  expect(output).toHaveBeenCalledOnce();
  expect(output).toHaveBeenCalledWith("uno", "AB");
  await act(async () => root!.render(pane()));
  expect(invoke.mock.calls.filter(([name]) => name === "create_terminal")).toHaveLength(1);
  expect(host.querySelector("button")).toBeNull();
  handlers.get("terminal-output-uno")!(outputEvent([67]));
  await act(async () => handlers.get("terminal-exit-uno")!({ payload: undefined }));
  expect(output).toHaveBeenLastCalledWith("uno", "C");
  expect(finished).toHaveBeenCalledWith("uno", null);
  host.querySelector("button")!.click();
  expect(restart).toHaveBeenCalledOnce();
  await unmount();
  expect(removeOutput).toHaveBeenCalledOnce();
  expect(removeExit).toHaveBeenCalledOnce();
  expect(listen).toHaveBeenCalledWith("terminal-output-uno", expect.any(Function));
  expect(listen).toHaveBeenCalledWith("terminal-exit-uno", expect.any(Function));
  expect(invoke).toHaveBeenCalledWith("close_terminal", { terminalId: "uno" });
});

test("desactiva el parpadeo al ocultar la terminal y lo restaura al activarla", async () => {
  await act(async () => root!.render(pane()));
  const options = terminalOptions.mock.calls[0][0] as { cursorBlink: boolean };
  expect(options.cursorBlink).toBe(true);

  await act(async () => root!.render(pane(false)));
  expect(options.cursorBlink).toBe(false);

  await act(async () => root!.render(pane(true)));
  expect(options.cursorBlink).toBe(true);
});

test("reconstruye UTF-8 dividido entre eventos PTY codificados en Base64", async () => {
  await act(async () => root!.render(pane()));
  handlers.get("terminal-output-uno")!(outputEvent([0xf0, 0x9f]));
  handlers.get("terminal-output-uno")!(outputEvent([0x8c, 0x8d]));

  expect(write).not.toHaveBeenCalled();
  await act(async () => new Promise((resolve) => window.setTimeout(resolve, 20)));
  expect(write).toHaveBeenCalledOnce();
  expect(Array.from(write.mock.calls[0][0] as Uint8Array)).toEqual([0xf0, 0x9f, 0x8c, 0x8d]);
  expect(output).toHaveBeenCalledWith("uno", "🌍");
});

test("una ráfaga de eventos PTY reduce escrituras xterm y decodificaciones de contexto", async () => {
  await act(async () => root!.render(pane()));
  const payload = { payload: { dataBase64: btoa("A".repeat(32 * 1024)) } };
  const onOutput = handlers.get("terminal-output-uno")!;

  for (let index = 0; index < 64; index += 1) onOutput(payload);

  expect(write).toHaveBeenCalledTimes(8);
  expect(output).toHaveBeenCalledTimes(8);
  expect(write.mock.calls.reduce((total, [bytes]) => total + (bytes as Uint8Array).length, 0))
    .toBe(64 * 32 * 1024);
  expect(output.mock.calls.every(([, text]) => text.length === 24_000)).toBe(true);
  expect(invoke.mock.calls.filter(([name]) => name === "ack_terminal_output")).toHaveLength(8);
  expect(invoke.mock.calls.filter(([name]) => name === "ack_terminal_output")
    .reduce((total, [, args]) => total + (args as { bytes: number }).bytes, 0)).toBe(2 * 1024 * 1024);
});

test("confirma los bytes solo cuando xterm termina de procesar el lote", async () => {
  let processed!: () => void;
  write.mockImplementationOnce((_data, callback) => { processed = callback!; });
  await act(async () => root!.render(pane()));
  handlers.get("terminal-output-uno")!(outputEvent([65, 66, 67]));
  await act(async () => new Promise((resolve) => window.setTimeout(resolve, 20)));

  expect(invoke).not.toHaveBeenCalledWith("ack_terminal_output", expect.anything());
  processed();
  expect(invoke).toHaveBeenCalledWith("ack_terminal_output", { terminalId: "uno", bytes: 3 });
});

test("limita el historial en memoria del terminal a 2.500 líneas", async () => {
  await act(async () => root!.render(pane()));
  expect(terminalOptions).toHaveBeenCalledWith(expect.objectContaining({ scrollback: 2_500 }));
});

test("copia la selección de xterm y limpia solo la pantalla solicitada", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  getSelection.mockReturnValue("texto seleccionado");
  await act(async () => root!.render(pane(true, { sequence: 1, terminalId: "uno" }, { sequence: 1, terminalId: "uno" })));
  await act(async () => Promise.resolve());

  expect(writeText).toHaveBeenCalledWith("texto seleccionado");
  expect(clear).toHaveBeenCalledOnce();
  expect(actionNotice).toHaveBeenCalledWith("Pantalla de terminal limpiada.");
  expect(actionNotice).toHaveBeenCalledWith("Selección copiada al portapapeles.");
});

test("copiar sin selección avisa y no escribe en el portapapeles", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  getSelection.mockReturnValue("");
  await act(async () => root!.render(pane(true, { sequence: 1, terminalId: "uno" })));

  expect(writeText).not.toHaveBeenCalled();
  expect(actionNotice).toHaveBeenCalledWith("Selecciona texto en la terminal para copiarlo.");
});

test("copiar con portapapeles no disponible muestra aviso y no rompe la terminal", async () => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  getSelection.mockReturnValue("texto seleccionado");
  await act(async () => root!.render(pane(true, { sequence: 1, terminalId: "uno" })));

  expect(actionNotice).toHaveBeenCalledWith("No se pudo acceder al portapapeles.");
  expect(host.querySelector(".terminal-pane")).not.toBeNull();
});

test("avisa cuando el portapapeles rechaza la escritura", async () => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("permission denied")) } });
  getSelection.mockReturnValue("texto seleccionado");
  await act(async () => root!.render(pane(true, { sequence: 1, terminalId: "uno" })));
  await act(async () => Promise.resolve());

  expect(actionNotice).toHaveBeenCalledWith("No se pudo acceder al portapapeles.");
});

test("una petición de terminal dirigida a otra pestaña no altera esta sesión", async () => {
  await act(async () => root!.render(pane(true, { sequence: 1, terminalId: "otra" }, { sequence: 1, terminalId: "otra" })));
  expect(getSelection).not.toHaveBeenCalled();
  expect(clear).not.toHaveBeenCalled();
  expect(actionNotice).not.toHaveBeenCalled();
});

test("cerrar mientras se registra la salida evita arrancar el proceso", async () => {
  let subscribed!: (remove: () => void) => void;
  listen.mockImplementationOnce(() => new Promise(resolve => { subscribed = resolve; }));
  await act(async () => root!.render(pane()));
  await unmount();
  await act(async () => subscribed(removeOutput));
  expect(removeOutput).toHaveBeenCalledOnce();
  expect(invoke).not.toHaveBeenCalled();
});

test("cierra la suscripción de salida si el componente se desmonta al registrarla", async () => {
  let finishExitRegistration!: (remove: () => void) => void;
  listen.mockImplementation(async (name) => name === "terminal-output-uno"
    ? removeOutput
    : new Promise(resolve => { finishExitRegistration = resolve; }));
  await act(async () => root!.render(pane()));
  await act(async () => Promise.resolve());
  await unmount();
  await act(async () => finishExitRegistration(removeExit));

  expect(removeExit).toHaveBeenCalledOnce();
  expect(invoke).not.toHaveBeenCalledWith("create_terminal", expect.anything());
});

test("cerrar durante el arranque espera al proceso y después lo cierra", async () => {
  let started!: () => void;
  invoke.mockImplementationOnce(() => new Promise<void>(resolve => { started = resolve; }));
  await act(async () => root!.render(pane()));
  await unmount();
  expect(invoke.mock.calls.map(([name]) => name)).toEqual(["create_terminal"]);
  await act(async () => started());
  expect(invoke.mock.calls.map(([name]) => name)).toEqual(["create_terminal", "close_terminal"]);
});

test("muestra el error del shell si falla el arranque", async () => {
  invoke.mockRejectedValueOnce(new Error("shell unavailable"));
  await act(async () => root!.render(pane()));
  await act(async () => new Promise(resolve => setTimeout(resolve, 0)));

  expect(write).toHaveBeenCalledWith("No se pudo iniciar cmd: Error: shell unavailable");
  expect(host.querySelector("button")?.textContent).toBe("Reiniciar terminal");
});

test("no muestra un error de arranque si la terminal ya se desmontó", async () => {
  let rejectStart!: (error: Error) => void;
  invoke.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectStart = reject; }));
  await act(async () => root!.render(pane()));
  await act(async () => Promise.resolve());
  await unmount();
  await act(async () => rejectStart(new Error("startup cancelled")));

  expect(write).not.toHaveBeenCalled();
});

test("no envía entrada si la shell termina antes de completar el arranque", async () => {
  let finishStart!: () => void;
  invoke.mockImplementationOnce(() => new Promise<void>(resolve => { finishStart = resolve; }));
  await act(async () => root!.render(pane()));
  const input = onData.mock.calls[0][0];
  input("echo demasiado pronto");
  await act(async () => handlers.get("terminal-exit-uno")!({ payload: undefined }));
  await act(async () => finishStart());
  await act(async () => new Promise(resolve => setTimeout(resolve, 0)));

  expect(invoke).not.toHaveBeenCalledWith("write_terminal", expect.anything());
});

test("prepara el comando en la línea sin enviar Enter", async () => {
  await act(async () => root!.render(pane()));
  await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
  await act(async () => root!.render(pane(true, undefined, undefined, actionNotice, "cmd", false, { sequence: 1, terminalId: "uno", command: "dir" })));

  expect(invoke).toHaveBeenCalledWith("write_terminal", { terminalId: "uno", data: "dir" });
  expect(invoke).not.toHaveBeenCalledWith("write_terminal", { terminalId: "uno", data: "dir\r" });
  expect(actionNotice).toHaveBeenCalledWith("Comando preparado. Revísalo y pulsa Intro para ejecutarlo.");
});

test("no pisa texto que ya está escrito en la línea", async () => {
  await act(async () => root!.render(pane()));
  await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
  const input = onData.mock.calls[0][0];
  await act(async () => input("texto existente"));
  await act(async () => root!.render(pane(true, undefined, undefined, actionNotice, "cmd", false, { sequence: 1, terminalId: "uno", command: "dir" })));

  expect(invoke).not.toHaveBeenCalledWith("write_terminal", { terminalId: "uno", data: "dir" });
  expect(actionNotice).toHaveBeenCalledWith("La terminal ya tiene texto escrito; envíalo o bórralo antes.");
});

test("no prepara comandos en una terminal ocupada ni comandos multilínea", async () => {
  await act(async () => root!.render(pane()));
  await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
  const input = onData.mock.calls[0][0];
  await act(async () => input("dir\r"));
  await act(async () => root!.render(pane(true, undefined, undefined, actionNotice, "cmd", false, { sequence: 1, terminalId: "uno", command: "whoami" })));
  expect(actionNotice).toHaveBeenCalledWith("La terminal está ejecutando un comando y no puede recibir otro todavía.");

  await act(async () => root!.render(pane(true, undefined, undefined, actionNotice, "cmd", false, { sequence: 2, terminalId: "uno", command: "dir\rwhoami" })));
  expect(actionNotice).toHaveBeenLastCalledWith("No se pudo preparar el comando en la terminal.");
});

test("ignora solicitudes para otra terminal y muestra un aviso si la terminal aún no está lista", async () => {
  await act(async () => root!.render(pane(true, undefined, undefined, actionNotice, "cmd", false, { sequence: 1, terminalId: "otra", command: "dir" })));
  expect(actionNotice).not.toHaveBeenCalled();

  await unmount();
  root = createRoot(host);
  await act(async () => root!.render(pane(true, undefined, undefined, actionNotice, "cmd", false, { sequence: 2, terminalId: "uno", command: "dir" })));
  expect(actionNotice).toHaveBeenCalledWith("No se pudo preparar el comando en la terminal.");
});

test("informa si todavía no existe un controlador de terminal", async () => {
  skipTerminalInitialization.value = true;
  await act(async () => root!.render(pane(true, undefined, undefined, actionNotice, "cmd", false, { sequence: 3, terminalId: "uno", command: "dir" })));
  expect(actionNotice).toHaveBeenCalledWith("No se pudo preparar el comando en la terminal.");
  skipTerminalInitialization.value = false;
});

test("rechaza la inserción si el envío al proceso falla", async () => {
  await act(async () => root!.render(pane()));
  await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
  invoke.mockImplementation(async (command: string) => {
    if (command === "write_terminal") throw new Error("pty unavailable");
    return undefined;
  });
  await act(async () => root!.render(pane(true, undefined, undefined, actionNotice, "cmd", false, { sequence: 1, terminalId: "uno", command: "dir" })));
  await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
  expect(actionNotice).toHaveBeenLastCalledWith("No se pudo preparar el comando en la terminal.");
});

test("no envía el comando si la sesión termina mientras espera la cola de entrada", async () => {
  let releaseInput!: () => void;
  invoke.mockImplementation(async (name: string, args?: { data?: string }) => {
    if (name === "write_terminal" && args?.data === "\x03") await new Promise<void>(resolve => { releaseInput = resolve; });
    return undefined;
  });
  await act(async () => root!.render(pane()));
  await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
  const input = onData.mock.calls[0][0];
  await act(async () => input("\x03"));
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("write_terminal", { terminalId: "uno", data: "\x03" }));
  await act(async () => root!.render(pane(true, undefined, undefined, actionNotice, "cmd", false, { sequence: 1, terminalId: "uno", command: "dir" })));
  await act(async () => handlers.get("terminal-exit-uno")!({ payload: undefined }));
  await act(async () => releaseInput());

  expect(invoke).not.toHaveBeenCalledWith("write_terminal", { terminalId: "uno", data: "dir" });
  expect(actionNotice).toHaveBeenLastCalledWith("No se pudo preparar el comando en la terminal.");
});

test("no muestra avisos de inserción tardíos tras cerrar la terminal", async () => {
  let resolveWrite!: () => void;
  await act(async () => root!.render(pane()));
  await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
  invoke.mockImplementation(async (name: string) => {
    if (name === "write_terminal") await new Promise<void>(resolve => { resolveWrite = resolve; });
    return undefined;
  });
  await act(async () => root!.render(pane(true, undefined, undefined, actionNotice, "cmd", false, { sequence: 1, terminalId: "uno", command: "dir" })));
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("write_terminal", { terminalId: "uno", data: "dir" }));
  await unmount();
  await act(async () => resolveWrite());
  expect(actionNotice).not.toHaveBeenCalledWith("Comando preparado. Revísalo y pulsa Intro para ejecutarlo.");
});

test("no muestra fallos tardíos de inserción tras cerrar la terminal", async () => {
  let rejectWrite!: (error: Error) => void;
  await act(async () => root!.render(pane()));
  await act(async () => new Promise(resolve => setTimeout(resolve, 0)));
  invoke.mockImplementation(async (name: string) => {
    if (name === "write_terminal") await new Promise<void>((_resolve, reject) => { rejectWrite = reject; });
    return undefined;
  });
  await act(async () => root!.render(pane(true, undefined, undefined, actionNotice, "cmd", false, { sequence: 1, terminalId: "uno", command: "dir" })));
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("write_terminal", { terminalId: "uno", data: "dir" }));
  await unmount();
  await act(async () => rejectWrite(new Error("terminal closed")));
  expect(actionNotice).not.toHaveBeenCalledWith("No se pudo preparar el comando en la terminal.");
});

test("ignora el error al cerrar una sesión durante el desmontaje", async () => {
  invoke.mockImplementation(async (command: string) => {
    if (command === "close_terminal") throw new Error("already closed");
    return undefined;
  });
  await act(async () => root!.render(pane()));
  await unmount();
  await act(async () => Promise.resolve());

  expect(invoke).toHaveBeenCalledWith("close_terminal", { terminalId: "uno" });
});

test("mantiene la terminal abierta si falla el envío de entrada al PTY", async () => {
  invoke.mockImplementation(async (command: string) => {
    if (command === "write_terminal") throw new Error("pty unavailable");
    return undefined;
  });
  await act(async () => root!.render(pane()));
  await act(async () => {
    onData.mock.calls[0][0]("echo listo");
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  expect(write).toHaveBeenCalledWith("\r\n\x1b[31mLaural: Error: pty unavailable\x1b[0m\r\n");
  expect(host.querySelector(".terminal-pane")).not.toBeNull();
});

test("entrega la respuesta del cursor cuando termina el arranque", async () => {
  let started!: () => void;
  invoke.mockImplementationOnce(() => new Promise<void>(resolve => { started = resolve; }));
  await act(async () => root!.render(pane()));
  onData.mock.calls[0][0]("\x1b[1;1R");
  expect(invoke.mock.calls.map(([name]) => name)).toEqual(["create_terminal"]);
  await act(async () => started());
  expect(invoke).toHaveBeenCalledWith("write_terminal", { terminalId: "uno", data: "\x1b[1;1R" });
});

test("reenvía Ctrl+C como ETX a la sesión y no lo registra como comando", async () => {
  await act(async () => root!.render(pane()));
  const input = onData.mock.calls[0][0];

  await act(async () => {
    input("\x03");
    input("\r");
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  expect(invoke).toHaveBeenCalledWith("write_terminal", { terminalId: "uno", data: "\x03" });
  expect(submit).not.toHaveBeenCalled();
});

test("captura el comando enviado y el código de salida del bloque", async () => {
  await act(async () => root!.render(pane()));
  const input = onData.mock.calls[0][0];
  const oscHandler = registerOscHandler.mock.calls[0][1];

  await act(async () => {
    input("  git status  ");
    input("\r");
    input("\n");
    oscHandler("A");
    oscHandler("B");
    oscHandler("C");
    oscHandler("D;37");
  });

  expect(submit).toHaveBeenCalledOnce();
  expect(submit).toHaveBeenCalledWith("uno", "git status");
  expect(finished).toHaveBeenCalledWith("uno", 37);
  expect(oscHandler("D;código-inválido")).toBe(true);
  expect(finished).toHaveBeenLastCalledWith("uno", null);
});

test("captura el texto corregido con ambos códigos de Retroceso", async () => {
  await act(async () => root!.render(pane()));
  const input = onData.mock.calls[0][0];

  await act(async () => {
    input("git statuX");
    input("\x7f");
    input("s\r");
    input("echo listx");
    input("\b");
    input("o\r");
  });

  expect(submit.mock.calls).toEqual([
    ["uno", "git status"],
    ["uno", "echo listo"],
  ]);
});

test("ignora Retroceso sobre una línea vacía y conserva salida OSC sin código válido", async () => {
  await act(async () => root!.render(pane()));
  const input = onData.mock.calls[0][0];
  const oscHandler = registerOscHandler.mock.calls[0][1];

  await act(async () => {
    input("\x7f");
    input("\b");
    input("\n");
    oscHandler("D");
  });

  expect(submit).not.toHaveBeenCalled();
  expect(finished).toHaveBeenCalledWith("uno", null);
  expect(oscHandler("Z;0")).toBe(false);
});

test("ignora eventos de salida mal codificados", async () => {
  await act(async () => root!.render(pane()));
  handlers.get("terminal-output-uno")!({ payload: { dataBase64: "%%%" } });
  await act(async () => new Promise(resolve => setTimeout(resolve, 20)));

  expect(write).not.toHaveBeenCalled();
  expect(output).not.toHaveBeenCalled();
});

test("ignora callbacks tardíos de salida, salida de shell y teclado tras cerrar", async () => {
  await act(async () => root!.render(pane()));
  const outputHandler = handlers.get("terminal-output-uno")!;
  const exitHandler = handlers.get("terminal-exit-uno")!;
  const input = onData.mock.calls[0][0];
  await unmount();

  await act(async () => {
    outputHandler(outputEvent([65]));
    exitHandler({ payload: undefined });
    input("echo tardío");
  });

  expect(output).not.toHaveBeenCalled();
  expect(finished).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalledWith("write_terminal", expect.anything());
});

test("no escribe un error en xterm si un envío falla después del desmontaje", async () => {
  let rejectWrite!: (error: Error) => void;
  invoke.mockImplementation(async (command: string) => command === "write_terminal"
    ? new Promise<void>((_resolve, reject) => { rejectWrite = reject; })
    : undefined);
  await act(async () => root!.render(pane()));
  await act(async () => {
    onData.mock.calls[0][0]("echo listo");
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  await unmount();
  await act(async () => rejectWrite(new Error("terminal closed")));

  expect(write).not.toHaveBeenCalledWith(expect.stringContaining("Laural:"));
});

test("no atribuye un comando incorrecto tras controles de edición, historial y autocompletado", async () => {
  await act(async () => root!.render(pane()));
  const input = onData.mock.calls[0][0];

  await act(async () => {
    for (const key of ["\x01", "\x02", "\x05", "\x06", "\x07", "\x09", "\x0b", "\x0c", "\x0e", "\x0f", "\x10", "\x12", "\x13", "\x14", "\x15", "\x16", "\x17", "\x19", "\x1f", "\x1b[A"]) {
      input("git status");
      input(key);
      input("--short\r");
    }
  });

  expect(submit.mock.calls).toEqual(Array.from({ length: 20 }, () => [
    "uno",
    "Comando editado en el shell; texto no capturado",
  ]));
});

test("marca como editada la línea que el usuario modifica dentro del shell", async () => {
  await act(async () => root!.render(pane()));
  const input = onData.mock.calls[0][0];

  await act(async () => {
    input("comando original");
    input("\x1b[A");
    input("comando editado\r\n");
  });

  expect(submit).toHaveBeenCalledOnce();
  expect(submit).toHaveBeenCalledWith("uno", "Comando editado en el shell; texto no capturado");
});

test("captura Enter enviado con LF y no registra líneas vacías", async () => {
  await act(async () => root!.render(pane()));
  const input = onData.mock.calls[0][0];

  await act(async () => {
    input("echo desde LF\n");
    input("\n");
    input("\x1b[A");
    input("comando editado con LF\n");
  });

  expect(submit.mock.calls).toEqual([
    ["uno", "echo desde LF"],
    ["uno", "Comando editado en el shell; texto no capturado"],
  ]);
});
