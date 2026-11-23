import type { Pool } from "pg";

const MAX_ATTEMPTS = 8;
const MAX_BATCH_SIZE = 20;

export interface AccountRecoveryNoticeSender {
  sendAccountRecoveryNotice(input: { caseId: string; accountEmail: string; notificationId: string }): Promise<void>;
}

type PendingNotice = { id: string; case_id: string; account_email: string; attempts: number };

export async function deliverAccountRecoveryNoticeBatch(
  pool: Pick<Pool, "connect" | "query">,
  sender: AccountRecoveryNoticeSender,
  requestedLimit = 10,
): Promise<{ delivered: number; deferred: number }> {
  const limit = Math.max(1, Math.min(MAX_BATCH_SIZE, Math.floor(requestedLimit)));
  let delivered = 0;
  let deferred = 0;
  for (let index = 0; index < limit; index += 1) {
    const notice = await claimNotice(pool);
    if (!notice) break;
    try {
      await sender.sendAccountRecoveryNotice({ caseId: notice.case_id, accountEmail: notice.account_email, notificationId: notice.id });
      await pool.query("UPDATE account_recovery_notice_outbox SET delivered_at = now(), claimed_at = NULL WHERE id = $1", [notice.id]);
      delivered += 1;
    } catch {
      const delay = Math.min(30 * 2 ** Math.max(notice.attempts - 1, 0), 21_600);
      await pool.query(
        `UPDATE account_recovery_notice_outbox SET claimed_at = NULL,
           next_attempt_at = now() + ($2::integer * interval '1 second'),
           abandoned_at = CASE WHEN attempts >= $3 THEN now() ELSE NULL END
         WHERE id = $1 AND delivered_at IS NULL AND abandoned_at IS NULL`, [notice.id, delay, MAX_ATTEMPTS],
      );
      deferred += 1;
    }
  }
  return { delivered, deferred };
}

async function claimNotice(pool: Pick<Pool, "connect">): Promise<PendingNotice | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<PendingNotice>(
      `SELECT n.id, n.case_id, a.email AS account_email, n.attempts
         FROM account_recovery_notice_outbox n
         JOIN account_recovery_cases c ON c.id = n.case_id
         JOIN accounts a ON a.id = c.account_id
        WHERE n.delivered_at IS NULL AND n.abandoned_at IS NULL AND n.next_attempt_at <= now()
          AND (n.claimed_at IS NULL OR n.claimed_at < now() - interval '5 minutes')
        ORDER BY n.created_at, n.id FOR UPDATE OF n SKIP LOCKED LIMIT 1`,
    );
    const pending = result.rows[0];
    if (!pending) { await client.query("COMMIT"); return null; }
    const claimed = await client.query<PendingNotice>(
      `UPDATE account_recovery_notice_outbox SET claimed_at = now(), attempts = attempts + 1
        WHERE id = $1 RETURNING id, case_id, $2::text AS account_email, attempts`, [pending.id, pending.account_email],
    );
    await client.query("COMMIT");
    return claimed.rows[0] ?? null;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
