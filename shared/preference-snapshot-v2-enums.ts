export {
  snapshotAppearances,
  snapshotProviderKinds,
  snapshotThemeIds,
  snapshotUpdateModes,
} from "./preference-snapshot-v1-enums.js";
export type {
  SnapshotAppearance,
  SnapshotProviderKind,
  SnapshotThemeId,
  SnapshotUpdateMode,
} from "./preference-snapshot-v1-enums.js";

export const snapshotLanguages = ["es", "en"] as const;
export type SnapshotLanguage = (typeof snapshotLanguages)[number];
