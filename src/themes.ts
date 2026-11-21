import type { ITheme } from "@xterm/xterm";

export type AppearanceMode = "dark" | "light";
export type ThemeDefinition = { id: string; name: string; accentDark: string; accentLight: string };

export const themes: ThemeDefinition[] = [
  { id: "laurel", name: "Laural", accentDark: "#b9f27c", accentLight: "#416b24" },
  { id: "ocean", name: "Océano", accentDark: "#67d5ff", accentLight: "#006d91" },
  { id: "indigo", name: "Índigo", accentDark: "#9ca8ff", accentLight: "#4857b4" },
  { id: "lavender", name: "Lavanda", accentDark: "#c4a1ff", accentLight: "#7042a6" },
  { id: "rose", name: "Rosa", accentDark: "#ff9bb5", accentLight: "#ad3f62" },
  { id: "coral", name: "Coral", accentDark: "#ffae8a", accentLight: "#aa4e2a" },
  { id: "amber", name: "Ámbar", accentDark: "#f5cc73", accentLight: "#82600e" },
  { id: "teal", name: "Verde azulado", accentDark: "#65d7c4", accentLight: "#077164" },
  { id: "sky", name: "Cielo", accentDark: "#73c8f6", accentLight: "#176b9a" },
  { id: "ruby", name: "Rubí", accentDark: "#ff8294", accentLight: "#ac3348" },
  { id: "graphite", name: "Grafito", accentDark: "#d0d3da", accentLight: "#505561" },
  { id: "sand", name: "Arena", accentDark: "#e0bc8e", accentLight: "#805b2c" },
];

function blend(hex: string, target: string, amount: number): string {
  const source = hex.slice(1).match(/.{2}/g)!.map((value) => Number.parseInt(value, 16));
  const destination = target.slice(1).match(/.{2}/g)!.map((value) => Number.parseInt(value, 16));
  return `#${source.map((channel, index) => Math.round(channel * (1 - amount) + destination[index] * amount).toString(16).padStart(2, "0")).join("")}`;
}

export function themeVariables(theme: ThemeDefinition, mode: AppearanceMode) {
  const accent = mode === "dark" ? theme.accentDark : theme.accentLight;
  return {
    accent,
    hover: blend(accent, mode === "dark" ? "#ffffff" : "#000000", 0.16),
    strong: blend(accent, mode === "dark" ? "#000000" : "#ffffff", 0.12),
    muted: blend(accent, mode === "dark" ? "#ffffff" : "#000000", 0.24),
  };
}

export function terminalTheme(theme: ThemeDefinition, mode: AppearanceMode): ITheme {
  const accent = mode === "dark" ? theme.accentDark : theme.accentLight;
  if (mode === "light") {
    return {
      background: "#fafaf9", foreground: "#20242d", cursor: accent,
      cursorAccent: "#fafaf9", selectionBackground: `${accent}40`,
      black: "#25272e", red: "#b42335", green: accent, yellow: "#8a6500",
      blue: "#176b9a", magenta: "#7846a8", cyan: "#087b6d", white: "#d8dbe2",
      brightBlack: "#666b75", brightRed: "#c83d50", brightGreen: accent,
      brightYellow: "#9b760f", brightBlue: "#287da9", brightMagenta: "#8955b7",
      brightCyan: "#168b7c", brightWhite: "#ffffff",
    };
  }
  return {
    background: "#101115", foreground: "#e2e4e9", cursor: accent,
    cursorAccent: "#101115", selectionBackground: `${accent}50`,
    black: "#272a33", red: "#ff758f", green: accent, yellow: "#f6cd75",
    blue: "#88a8ff", magenta: "#d3a3ff", cyan: "#76dbd1", white: "#d2d6df",
    brightBlack: "#626879", brightRed: "#ff91a6", brightGreen: themeVariables(theme, mode).hover,
    brightYellow: "#ffe19a", brightBlue: "#a1baff", brightMagenta: "#e2bdff",
    brightCyan: "#91eee5", brightWhite: "#ffffff",
  };
}
