import type { Pool } from "pg";

const MAX_ATTEMPTS = 8;
const MAX_BATCH_SIZE = 50;
const CLAIM_TIMEOUT = "5 minutes";
const MAX_RETRY_DELAY_SECONDS = 6 * 60 * 60;

export type SecurityEmailEvent = "totp_enabled" | "recovery_codes_rotated" | "totp_disabled" | "passkey_added" | "passkey_removed" | "account_recovered";

export interface SecurityEmailSender {
  sendSecurityNotice(input: { email: string; eventType: SecurityEmailEvent; notificationId: string }): Promise<void>;
}

type PendingNotice = { id: string; recipient_email: string; event_type: SecurityEmailEvent; attempts: number };

export async function deliverSecurityEmailBatch(
  pool: Pick<Pool, "connect" | "query">,
  sender: SecurityEmailSender,
  requestedLimit = 20,
): Promise<{ delivered: number; deferred: number }> {
  const limit = Math.max(1, Math.min(MAX_BATCH_SIZE, Math.floor(requestedLimit)));
  let delivered = 0;
  let deferred = 0;

  for (let index = 0; index < limit; index += 1) {
    const notice = await claimNextNotice(pool);
    if (!notice) break;
    try {
      await sender.sendSecurityNotice({
        email: notice.recipient_email,
        eventType: notice.event_type,
        notificationId: notice.id,
      });
      await markDelivered(pool, notice.id);
      delivered += 1;
    } catch {
      await deferNotice(pool, notice);
      deferred += 1;
    }
  }

  return { delivered, deferred };
}

async function claimNextNotice(pool: Pick<Pool, "connect" | "query">): Promise<PendingNotice | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<PendingNotice>(
      `SELECT id, recipient_email, event_type, attempts
         FROM account_security_email_outbox
        WHERE delivered_at IS NULL AND abandoned_at IS NULL AND available_at <= now()
          AND (claimed_at IS NULL OR claimed_at < now() - interval '${CLAIM_TIMEOUT}')
        ORDER BY created_at, id
        FOR UPDATE SKIP LOCKED LIMIT 1`,
    );
    const notice = result.rows[0];
    if (!notice) {
      await client.query("COMMIT");
      return null;
    }
    const claimed = await client.query<PendingNotice>(
      `UPDATE account_security_email_outbox
          SET claimed_at = now(), attempts = attempts + 1
        WHERE id = $1
        RETURNING id, recipient_email, event_type, attempts`,
      [notice.id],
    );
    await client.query("COMMIT");
    return claimed.rows[0] ?? null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function markDelivered(pool: Pick<Pool, "connect" | "query">, id: string): Promise<void> {
  await pool.query(
    `UPDATE account_security_email_outbox
        SET delivered_at = now(), claimed_at = NULL
      WHERE id = $1 AND delivered_at IS NULL AND abandoned_at IS NULL`,
    [id],
  );
}

async function deferNotice(pool: Pick<Pool, "connect" | "query">, notice: PendingNotice): Promise<void> {
  const delaySeconds = Math.min(30 * (2 ** Math.max(notice.attempts - 1, 0)), MAX_RETRY_DELAY_SECONDS);
  await pool.query(
    `UPDATE account_security_email_outbox
        SET claimed_at = NULL,
            available_at = now() + ($2::integer * interval '1 second'),
            abandoned_at = CASE WHEN attempts >= $3 THEN now() ELSE NULL END
      WHERE id = $1 AND delivered_at IS NULL AND abandoned_at IS NULL`,
    [notice.id, delaySeconds, MAX_ATTEMPTS],
  );
}
