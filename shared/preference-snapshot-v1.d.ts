export type SnapshotAppearance = "dark" | "light";
export type SnapshotUpdateMode = "manual" | "automatic";
export type SnapshotProviderKind = "freellmapi" | "ollama" | "lmstudio" | "custom";

export type PreferenceSnapshot = {
  schemaVersion: 1;
  preferences: {
    themeId: string;
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
