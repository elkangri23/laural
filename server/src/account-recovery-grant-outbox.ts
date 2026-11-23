import type { Pool } from "pg";
import { decryptRecoveryTicket, type EncryptedRecoveryTicket } from "./recovery-ticket-crypto.js";

const MAX_ATTEMPTS = 8;
const MAX_BATCH_SIZE = 20;

export interface AccountRecoveryGrantSender {
  sendAccountRecoveryGrant(input: { email: string; ticket: string; grantId: string }): Promise<void>;
}

type PendingGrant = { id: string; grant_id: string; account_email: string; encrypted_ticket: EncryptedRecoveryTicket; attempts: number };

export async function deliverAccountRecoveryGrantBatch(
  pool: Pick<Pool, "connect" | "query">,
  sender: AccountRecoveryGrantSender,
  recoveryPepper: string,
  requestedLimit = 10,
): Promise<{ delivered: number; deferred: number }> {
  const limit = Math.max(1, Math.min(MAX_BATCH_SIZE, Math.floor(requestedLimit)));
  let delivered = 0;
  let deferred = 0;
  for (let index = 0; index < limit; index += 1) {
    const grant = await claimNextGrant(pool);
    if (!grant) break;
    try {
      const ticket = decryptRecoveryTicket(grant.encrypted_ticket, recoveryPepper, grant.grant_id);
      await sender.sendAccountRecoveryGrant({ email: grant.account_email, ticket, grantId: grant.grant_id });
      await pool.query(
        `UPDATE account_recovery_grant_outbox
            SET delivered_at = now(), claimed_at = NULL, encrypted_ticket = NULL
          WHERE id = $1 AND delivered_at IS NULL AND abandoned_at IS NULL`, [grant.id],
      );
      delivered += 1;
    } catch {
      const delay = Math.min(30 * 2 ** Math.max(grant.attempts - 1, 0), 21_600);
      await pool.query(
        `UPDATE account_recovery_grant_outbox SET claimed_at = NULL,
           next_attempt_at = now() + ($2::integer * interval '1 second'),
           abandoned_at = CASE WHEN attempts >= $3 THEN now() ELSE NULL END,
           encrypted_ticket = CASE WHEN attempts >= $3 THEN NULL ELSE encrypted_ticket END
         WHERE id = $1 AND delivered_at IS NULL AND abandoned_at IS NULL`, [grant.id, delay, MAX_ATTEMPTS],
      );
      deferred += 1;
    }
  }
  return { delivered, deferred };
}

async function claimNextGrant(pool: Pick<Pool, "connect">): Promise<PendingGrant | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<PendingGrant>(
      `SELECT o.id, g.id AS grant_id, a.email AS account_email, o.encrypted_ticket, o.attempts
         FROM account_recovery_grant_outbox o
         JOIN account_recovery_grants g ON g.id = o.grant_id
         JOIN account_recovery_cases c ON c.id = g.case_id
         JOIN accounts a ON a.id = c.account_id
        WHERE o.delivered_at IS NULL AND o.abandoned_at IS NULL AND o.encrypted_ticket IS NOT NULL
          AND o.next_attempt_at <= now() AND g.expires_at > now() AND g.consumed_at IS NULL
          AND c.review_decision = 'approved' AND c.recovery_completed_at IS NULL AND a.deleted_at IS NULL
          AND (o.claimed_at IS NULL OR o.claimed_at < now() - interval '5 minutes')
        ORDER BY o.created_at, o.id FOR UPDATE OF o SKIP LOCKED LIMIT 1`,
    );
    const pending = result.rows[0];
    if (!pending) { await client.query("COMMIT"); return null; }
    const claimed = await client.query<PendingGrant>(
      `UPDATE account_recovery_grant_outbox SET claimed_at = now(), attempts = attempts + 1
        WHERE id = $1 RETURNING id, $2::uuid AS grant_id, $3::text AS account_email, encrypted_ticket, attempts`,
      [pending.id, pending.grant_id, pending.account_email],
    );
    await client.query("COMMIT");
    return claimed.rows[0] ?? null;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
