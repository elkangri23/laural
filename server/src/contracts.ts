import type { PreferenceSnapshot } from "../../shared/preference-snapshot-v1.js";
export type { PreferenceSnapshot, PreferenceSnapshotRevision } from "../../shared/preference-snapshot-v1.js";

export type StoredSnapshot = {
  snapshot: PreferenceSnapshot | null;
  revision: number;
};

export type WriteSnapshotResult =
  | { kind: "saved" | "replayed"; snapshot: PreferenceSnapshot; revision: number }
  | { kind: "unauthorized" }
  | { kind: "conflict"; revision: number }
  | { kind: "idempotency_key_reused" };

export interface PreferenceStore {
  get(accountId: string): Promise<StoredSnapshot>;
  put(
    accountId: string,
    expectedRevision: number,
    idempotencyKey: string,
    snapshot: PreferenceSnapshot,
  ): Promise<WriteSnapshotResult>;
}

export type Authenticate = (authorization: string | undefined) => Promise<string | null>;
export type RevokeSession = (accountId: string, authorization: string | undefined) => Promise<boolean>;
export type ReadinessCheck = () => Promise<void>;
