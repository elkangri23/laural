export type AppearanceMode = "dark" | "light";
export type UpdateMode = "manual" | "automatic";
export type SyncedProviderKind = "freellmapi" | "ollama" | "lmstudio" | "custom";

export type PreferenceSnapshot = {
  schemaVersion: 1;
  preferences: {
    themeId: string;
    appearance: AppearanceMode;
    updateMode: UpdateMode;
  };
  activeProviderId: string | null;
  providers: Array<{
    id: string;
    kind: SyncedProviderKind;
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
