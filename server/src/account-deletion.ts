import { createHash } from "node:crypto";
import type { Pool } from "pg";

export type AccountDeletionResult = "deleted" | "recent_auth_required" | "unauthorized";

export class AccountDeletionService {
  constructor(private readonly pool: Pool) {}

  async deleteAccount(accountId: string, authorization: string | undefined): Promise<AccountDeletionResult> {
    const token = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (!token) return "unauthorized";
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ recent_auth: boolean }>(
        `SELECT s.created_at > now() - interval '10 minutes' AS recent_auth
           FROM accounts AS a
           JOIN account_sessions AS s ON s.account_id = a.id
          WHERE a.id = $1 AND a.email_verified_at IS NOT NULL AND a.deleted_at IS NULL
            AND s.token_hash = $2 AND s.revoked_at IS NULL AND s.expires_at > now()
          FOR UPDATE OF a, s`,
        [accountId, tokenHash],
      );
      const session = result.rows[0];
      if (!session) {
        await client.query("ROLLBACK");
        return "unauthorized";
      }
      if (!session.recent_auth) {
        await client.query("COMMIT");
        return "recent_auth_required";
      }

      const deleted = await client.query("DELETE FROM accounts WHERE id = $1 RETURNING id", [accountId]);
      if (deleted.rowCount !== 1) {
        await client.query("ROLLBACK");
        return "unauthorized";
      }
      await client.query("COMMIT");
      return "deleted";
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
