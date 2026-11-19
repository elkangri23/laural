import { expect, test } from "vitest";
import { terminalTheme, themes, themeVariables } from "../src/themes";

test("las doce paletas tienen identificadores únicos", () => {
  expect(themes).toHaveLength(12);
  expect(new Set(themes.map(theme => theme.id)).size).toBe(12);
});

test.each(themes)("la terminal y la interfaz comparten el acento de $name", theme => {
  for (const mode of ["light", "dark"] as const) {
    const expected = mode === "light" ? theme.accentLight : theme.accentDark;
    expect(themeVariables(theme, mode).accent).toBe(expected);
    expect(terminalTheme(theme, mode).cursor).toBe(expected);
  }
});
