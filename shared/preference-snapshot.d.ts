import type { PreferenceSnapshot as PreferenceSnapshotV1 } from "./preference-snapshot-v1.js";
import type { PreferenceSnapshotV2 } from "./preference-snapshot-v2.js";

export type PreferenceSnapshot = PreferenceSnapshotV1 | PreferenceSnapshotV2;

export type PreferenceSnapshotRevision = {
  snapshot: PreferenceSnapshot | null;
  revision: number;
};
