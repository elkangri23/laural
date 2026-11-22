import type {
  SnapshotAppearance,
  SnapshotProviderKind,
  SnapshotThemeId,
  SnapshotUpdateMode,
} from "./preference-snapshot-v1-enums.js";

export type {
  SnapshotAppearance,
  SnapshotProviderKind,
  SnapshotThemeId,
  SnapshotUpdateMode,
};

export type PreferenceSnapshot = {
  schemaVersion: 1;
  preferences: {
    themeId: SnapshotThemeId;
    appearance: SnapshotAppearance;
    updateMode: SnapshotUpdateMode;
  };
  activeProviderId: string | null;
  providers: Array<{
    id: string;
    kind: SnapshotProviderKind;
    name: string;
    model: string;
    /** Present only after explicit consent to sync this custom endpoint. */
    customEndpoint?: string;
  }>;
};

export type PreferenceSnapshotRevision = {
  snapshot: PreferenceSnapshot | null;
  revision: number;
};
