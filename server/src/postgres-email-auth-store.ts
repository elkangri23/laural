import { timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import type { EmailAuthStore, VerificationChallenge } from "./email-auth.js";

export class PostgresEmailAuthStore implements EmailAuthStore {
  constructor(private readonly pool: Pool) {}

  async createUnverifiedAccount(input: { displayName: string; email: string; passwordHash: string }): Promise<{ id: string } | null> {
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO accounts (display_name, email, password_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (lower(email)) DO NOTHING
       RETURNING id`,
      [input.displayName, input.email, input.passwordHash],
    );
    return result.rows[0] ?? null;
  }

  async createVerification(email: string, verifier: string): Promise<VerificationChallenge | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const accountResult = await client.query<{ id: string; display_name: string }>(
        `SELECT id, display_name FROM accounts
          WHERE lower(email) = $1 AND email_verified_at IS NULL AND deleted_at IS NULL
          FOR UPDATE`,
        [email],
      );
      const account = accountResult.rows[0];
      if (!account) {
        await client.query("COMMIT");
        return null;
      }

      const usage = await client.query<{ recent_count: string; cooldown: boolean }>(
        `SELECT count(*) FILTER (WHERE created_at > now() - interval '15 minutes')::text AS recent_count,
                coalesce(max(created_at) > now() - interval '60 seconds', false) AS cooldown
           FROM email_verification_codes
          WHERE account_id = $1`,
        [account.id],
      );
      const row = usage.rows[0];
      if (!row || Number(row.recent_count) >= 3 || row.cooldown) {
        await client.query("COMMIT");
        return null;
      }

      await client.query(
        `UPDATE email_verification_codes
            SET consumed_at = now()
          WHERE account_id = $1 AND consumed_at IS NULL`,
        [account.id],
      );
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO email_verification_codes (account_id, verifier_digest, expires_at)
         VALUES ($1, $2, now() + interval '5 minutes')
         RETURNING id`,
        [account.id, verifier],
      );
      await client.query("COMMIT");
      const challengeId = inserted.rows[0]?.id;
      return challengeId ? { accountId: account.id, displayName: account.display_name, challengeId } : null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async verifyEmail(email: string, verifier: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const accountResult = await client.query<{ id: string; email_verified_at: Date | null }>(
        `SELECT id, email_verified_at FROM accounts
          WHERE lower(email) = $1 AND deleted_at IS NULL
          FOR UPDATE`,
        [email],
      );
      const account = accountResult.rows[0];
      if (!account) {
        await client.query("COMMIT");
        return false;
      }
      if (account.email_verified_at) {
        await client.query("COMMIT");
        return true;
      }

      const codeResult = await client.query<{
        id: string;
        verifier_digest: string;
        attempts: number;
        is_expired: boolean;
      }>(
        `SELECT id, verifier_digest, attempts, expires_at <= now() AS is_expired
           FROM email_verification_codes
          WHERE account_id = $1 AND consumed_at IS NULL
          ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [account.id],
      );
      const code = codeResult.rows[0];
      if (!code || code.is_expired || code.attempts >= 5) {
        if (code) await client.query("UPDATE email_verification_codes SET consumed_at = now() WHERE id = $1", [code.id]);
        await client.query("COMMIT");
        return false;
      }

      const supplied = Buffer.from(verifier, "hex");
      const stored = Buffer.from(code.verifier_digest, "hex");
      const matches = supplied.length === stored.length && timingSafeEqual(supplied, stored);
      if (!matches) {
        const attempts = code.attempts + 1;
        await client.query(
          `UPDATE email_verification_codes
              SET attempts = $2, consumed_at = CASE WHEN $2 >= 5 THEN now() ELSE consumed_at END
            WHERE id = $1`,
          [code.id, attempts],
        );
        await client.query("COMMIT");
        return false;
      }

      await client.query("UPDATE email_verification_codes SET consumed_at = now() WHERE id = $1", [code.id]);
      await client.query("UPDATE accounts SET email_verified_at = now() WHERE id = $1", [account.id]);
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
