// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import TerminalPane from "../src/components/TerminalPane";
import { themes } from "../src/themes";

const { invoke, listen, write, onData, registerOscHandler, terminalOptions, clear, getSelection } = vi.hoisted(() => ({
  invoke: vi.fn(), listen: vi.fn(), write: vi.fn(), onData: vi.fn(), registerOscHandler: vi.fn(), terminalOptions: vi.fn(), clear: vi.fn(), getSelection: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options = {}; parser = { registerOscHandler };
    rows = 28; cols = 100;
    constructor(options: unknown) { terminalOptions(options); }
    write = write; writeln = write;
    loadAddon() {} open() {} focus() {} dispose() {}
    clear = clear; getSelection = getSelection;
    onData = onData;
  },
}));

let root: Root | undefined;
let host: HTMLDivElement;
const finished = vi.fn(), restart = vi.fn(), output = vi.fn(), submit = vi.fn();
const actionNotice = vi.fn();
const handlers = new Map<string, (event: { payload: unknown }) => void>();
const removeOutput = vi.fn(), removeExit = vi.fn();
function pane(visible = true, copyRequest = { sequence: 0, terminalId: "" }, clearRequest = { sequence: 0, terminalId: "" }, onActionNotice = actionNotice) {
  return <TerminalPane terminalId="uno" shell="cmd" cwd={null} visible={visible} active={visible}
    copyRequest={copyRequest} clearRequest={clearRequest} onActionNotice={onActionNotice}
    appearance="dark" theme={themes[0]} onCommandFinish={finished} onRestart={restart}
    onTextOutput={output} onCommandSubmit={submit} />;
}
const outputEvent = (data: number[]) => ({ payload: { dataBase64: btoa(String.fromCharCode(...data)) } });
beforeEach(() => {
  vi.resetAllMocks();
  handlers.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.createElement("div");
  root = createRoot(host);
  listen.mockImplementation(async (name, fn) => {
    handlers.set(name, fn);
    return name === "terminal-output-uno" ? removeOutput : removeExit;
  });
  onData.mockReturnValue({ dispose() {} });
  registerOscHandler.mockReturnValue({ dispose() {} });
  invoke.mockResolvedValue(undefined);
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

test("ocultar la pestaña conserva el proceso y su salida; salir permite reiniciar", async () => {
  await act(async () => root!.render(pane()));
  await act(async () => root!.render(pane(false)));
  handlers.get("terminal-output-uno")!(outputEvent([65]));
  handlers.get("terminal-output-uno")!(outputEvent([66]));
  expect(write).toHaveBeenCalledTimes(2);
  expect(output).not.toHaveBeenCalled();
  await act(async () => new Promise((resolve) => window.setTimeout(resolve, 20)));
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

test("cerrar durante el arranque espera al proceso y después lo cierra", async () => {
  let started!: () => void;
  invoke.mockImplementationOnce(() => new Promise<void>(resolve => { started = resolve; }));
  await act(async () => root!.render(pane()));
  await unmount();
  expect(invoke.mock.calls.map(([name]) => name)).toEqual(["create_terminal"]);
  await act(async () => started());
  expect(invoke.mock.calls.map(([name]) => name)).toEqual(["create_terminal", "close_terminal"]);
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
