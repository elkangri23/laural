import { createHmac } from "node:crypto";
import type { Pool } from "pg";

const CLEANUP_AFTER_CALLS = 512;
const MAX_CLEANUP_BATCH = 1_000;

export interface RequestRateLimiter {
  consume(scope: string, clientAddress: string, maximum: number, windowSeconds: number): Promise<boolean>;
}

export class PostgresRequestRateLimiter implements RequestRateLimiter {
  private callsSinceCleanup = 0;
  private cleanupInProgress = false;

  constructor(private readonly pool: Pick<Pool, "query">, private readonly pepper: string) {
    const pepperBytes = Buffer.byteLength(pepper, "utf8");
    if (pepperBytes < 32 || pepperBytes > 256) throw new Error("El secreto de límites debe tener entre 32 y 256 bytes.");
  }

  async consume(scope: string, clientAddress: string, maximum: number, windowSeconds: number): Promise<boolean> {
    if (!/^[a-z0-9-]{1,64}$/.test(scope) || !Number.isInteger(maximum) || maximum < 1 || maximum > 1000
      || !Number.isInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > 86_400) {
      throw new Error("La política de límites de solicitudes no es válida.");
    }

    const keyDigest = createHmac("sha256", this.pepper)
      .update(scope)
      .update("\0")
      .update(clientAddress)
      .digest("hex");
    const result = await this.pool.query<{ allowed: boolean }>(
      `INSERT INTO request_rate_limits (scope, key_digest, window_started_at, request_count)
       VALUES ($1, $2, clock_timestamp(), 1)
       ON CONFLICT (scope, key_digest) DO UPDATE SET
         request_count = CASE
           WHEN request_rate_limits.window_started_at <= clock_timestamp() - ($3::int * interval '1 second') THEN 1
           ELSE LEAST(request_rate_limits.request_count + 1, $4::int + 1)
         END,
         window_started_at = CASE
           WHEN request_rate_limits.window_started_at <= clock_timestamp() - ($3::int * interval '1 second') THEN clock_timestamp()
           ELSE request_rate_limits.window_started_at
         END
       RETURNING request_count <= $4::int AS allowed`,
      [scope, keyDigest, windowSeconds, maximum],
    );

    this.callsSinceCleanup += 1;
    if (this.callsSinceCleanup >= CLEANUP_AFTER_CALLS) {
      this.callsSinceCleanup = 0;
      if (!this.cleanupInProgress) {
        this.cleanupInProgress = true;
        void Promise.resolve()
          .then(() => this.pool.query(
            `WITH expired AS (
               SELECT scope, key_digest
               FROM request_rate_limits
               WHERE window_started_at < now() - interval '24 hours'
               ORDER BY window_started_at
               LIMIT $1
             )
             DELETE FROM request_rate_limits AS limits
             USING expired
             WHERE limits.scope = expired.scope AND limits.key_digest = expired.key_digest`,
            [MAX_CLEANUP_BATCH],
          ))
          .catch(() => undefined)
          .finally(() => { this.cleanupInProgress = false; });
      }
    }
    return result.rows[0]?.allowed === true;
  }
}
