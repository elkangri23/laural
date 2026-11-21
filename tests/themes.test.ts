import { expect, test } from "vitest";
import { terminalTheme, themes, themeVariables } from "../src/themes";

function luminance(hex: string): number {
  const [red, green, blue] = hex.slice(1).match(/.{2}/g)!.map(channel => Number.parseInt(channel, 16) / 255);
  const linear = [red, green, blue].map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

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

test.each(themes)("el acento de $name mantiene contraste AA para texto en ambos modos", theme => {
  const backgrounds = { light: "#e9eaee", dark: "#111216" };
  for (const mode of ["light", "dark"] as const) {
    expect(contrastRatio(themeVariables(theme, mode).accent, backgrounds[mode])).toBeGreaterThanOrEqual(4.5);
  }
});
