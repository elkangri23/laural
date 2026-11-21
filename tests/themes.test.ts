import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { terminalTheme, themes, themeVariables } from "../src/themes";

const appCss = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");

function luminance(hex: string): number {
  const [red, green, blue] = hex.slice(1).match(/.{2}/g)!.map(channel => Number.parseInt(channel, 16) / 255);
  const linear = [red, green, blue].map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function cssVariable(block: string, name: string): string {
  const value = block.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];
  if (!value) throw new Error(`No se encontró el color CSS ${name}`);
  return value;
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

test.each(["dark", "light"] as const)("el texto secundario mantiene contraste AA en superficies del modo %s", mode => {
  const block = mode === "light"
    ? appCss.match(/:root\[data-mode="light"\]\s*\{([\s\S]*?)\n\}/)?.[1]
    : appCss.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1];
  if (!block) throw new Error(`No se encontró la configuración CSS del modo ${mode}`);
  const muted = cssVariable(block, "--palette-858894");
  for (const surface of ["--palette-17181d", "--palette-1d1e24", "--palette-202127"]) {
    expect(contrastRatio(muted, cssVariable(block, surface)), `${mode}: ${surface}`).toBeGreaterThanOrEqual(4.5);
  }
});
