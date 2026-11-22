export const snapshotThemeIds = [
  "laurel", "ocean", "indigo", "lavender", "rose", "coral",
  "amber", "teal", "sky", "ruby", "graphite", "sand",
] as const;

export const snapshotAppearances = ["dark", "light"] as const;
export const snapshotUpdateModes = ["manual", "automatic"] as const;
export const snapshotProviderKinds = ["freellmapi", "ollama", "lmstudio", "custom"] as const;

export type SnapshotAppearance = (typeof snapshotAppearances)[number];
export type SnapshotUpdateMode = (typeof snapshotUpdateModes)[number];
export type SnapshotThemeId = (typeof snapshotThemeIds)[number];
export type SnapshotProviderKind = (typeof snapshotProviderKinds)[number];
