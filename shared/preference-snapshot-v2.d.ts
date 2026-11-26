import type {
  SnapshotAppearance,
  SnapshotLanguage,
  SnapshotProviderKind,
  SnapshotThemeId,
  SnapshotUpdateMode,
} from "./preference-snapshot-v2-enums.js";

export type { SnapshotLanguage };

export type PreferenceSnapshotV2 = {
  schemaVersion: 2;
  preferences: {
    themeId: SnapshotThemeId;
    appearance: SnapshotAppearance;
    updateMode: SnapshotUpdateMode;
    language: SnapshotLanguage;
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
