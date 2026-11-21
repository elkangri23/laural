import type { Pool } from "pg";
import type { PreferenceSnapshot, PreferenceStore, StoredSnapshot, WriteSnapshotResult } from "./contracts.js";
import { snapshotDigest } from "./app.js";

export class PostgresPreferenceStore implements PreferenceStore {
  constructor(private readonly pool: Pool) {}

  async get(accountId: string): Promise<StoredSnapshot> {
    const result = await this.pool.query<{ snapshot: PreferenceSnapshot; revision: string }>(
      `SELECT p.snapshot, p.revision::text AS revision
         FROM account_preferences AS p
         JOIN accounts AS a ON a.id = p.account_id
        WHERE p.account_id = $1
          AND a.email_verified_at IS NOT NULL
          AND a.deleted_at IS NULL`,
      [accountId],
    );
    const row = result.rows[0];
    return row
      ? { snapshot: row.snapshot, revision: Number(row.revision) }
      : { snapshot: null, revision: 0 };
  }

  async put(
    accountId: string,
    expectedRevision: number,
    idempotencyKey: string,
    snapshot: PreferenceSnapshot,
  ): Promise<WriteSnapshotResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const account = await client.query(
        `SELECT id FROM accounts
          WHERE id = $1 AND email_verified_at IS NOT NULL AND deleted_at IS NULL
          FOR UPDATE`,
        [accountId],
      );
      if (account.rows.length === 0) {
        await client.query("ROLLBACK");
        return { kind: "unauthorized" };
      }

      const digest = snapshotDigest(snapshot);
      const previous = await client.query<{
        payload_digest: string;
        snapshot: PreferenceSnapshot;
        revision: string;
      }>(
        `SELECT payload_digest, snapshot, revision::text AS revision
           FROM preference_idempotency
          WHERE account_id = $1 AND idempotency_key = $2`,
        [accountId, idempotencyKey],
      );
      if (previous.rows[0]) {
        const row = previous.rows[0];
        await client.query("COMMIT");
        return row.payload_digest === digest
          ? { kind: "replayed", snapshot: row.snapshot, revision: Number(row.revision) }
          : { kind: "idempotency_key_reused" };
      }

      const current = await client.query<{ revision: string }>(
        "SELECT revision::text AS revision FROM account_preferences WHERE account_id = $1 FOR UPDATE",
        [accountId],
      );
      const revision = Number(current.rows[0]?.revision ?? "0");
      if (revision !== expectedRevision) {
        await client.query("COMMIT");
        return { kind: "conflict", revision };
      }

      const nextRevision = revision + 1;
      await client.query(
        `INSERT INTO account_preferences (account_id, snapshot, revision, updated_at)
         VALUES ($1, $2::jsonb, $3, now())
         ON CONFLICT (account_id) DO UPDATE
           SET snapshot = EXCLUDED.snapshot, revision = EXCLUDED.revision, updated_at = now()`,
        [accountId, JSON.stringify(snapshot), nextRevision],
      );
      await client.query(
        `INSERT INTO preference_idempotency
           (account_id, idempotency_key, payload_digest, snapshot, revision, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5, now())`,
        [accountId, idempotencyKey, digest, JSON.stringify(snapshot), nextRevision],
      );
      await client.query("COMMIT");
      return { kind: "saved", snapshot, revision: nextRevision };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
