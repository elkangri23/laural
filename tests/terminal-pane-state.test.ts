import { describe, expect, test, vi } from "vitest";
import { applyTerminalCursorBlink, applyTerminalTheme, initializeWithTerminalHost, readTerminalSelection } from "../src/terminalPaneState";
import { themes } from "../src/themes";

describe("estado visual y selección de terminal", () => {
  test("omite la sesión si falta el host y usa el host disponible", () => {
    const initialize = vi.fn(() => () => undefined);
    expect(initializeWithTerminalHost(null, initialize)).toBeUndefined();
    expect(initialize).not.toHaveBeenCalled();

    const host = {} as HTMLElement;
    const cleanup = initializeWithTerminalHost(host, initialize);
    expect(initialize).toHaveBeenCalledWith(host);
    expect(cleanup).toBeDefined();
  });

  test("aplica tema y apariencia cuando existe una terminal", () => {
    const terminal = { options: {} as { theme?: unknown; cursorBlink?: boolean }, getSelection: () => "" };
    applyTerminalTheme(terminal, themes[0], "dark");
    expect(terminal.options.theme).toMatchObject({ background: expect.any(String), foreground: expect.any(String) });
  });

  test("tolera que la referencia de terminal aún no exista al aplicar el tema", () => {
    expect(() => applyTerminalTheme(null, themes[0], "dark")).not.toThrow();
  });

  test("activa el parpadeo solo para la terminal visible y activa", () => {
    const terminal = { options: {} as { theme?: unknown; cursorBlink?: boolean }, getSelection: () => "" };
    applyTerminalCursorBlink(terminal, true, true);
    expect(terminal.options.cursorBlink).toBe(true);
    applyTerminalCursorBlink(terminal, false, true);
    expect(terminal.options.cursorBlink).toBe(false);
  });

  test("tolera que la referencia de terminal no exista al actualizar el cursor", () => {
    expect(() => applyTerminalCursorBlink(null, true, true)).not.toThrow();
  });

  test("devuelve la selección y normaliza una referencia ausente", () => {
    expect(readTerminalSelection({ options: {}, getSelection: () => "texto" })).toBe("texto");
    expect(readTerminalSelection(null)).toBe("");
  });
});
