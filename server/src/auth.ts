import { createHash } from "node:crypto";
import type { QueryResultRow } from "pg";
import type { Authenticate, RevokeSession } from "./contracts.js";

type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
};

const SESSION_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function createSessionAuthenticator(database: Queryable): Authenticate {
  return async (authorization) => {
    const token = sessionTokenFromHeader(authorization);
    if (!token) return null;

    const tokenHash = createHash("sha256").update(token).digest("hex");
    const result = await database.query<{ account_id: string }>(
      `SELECT s.account_id
         FROM account_sessions AS s
         JOIN accounts AS a ON a.id = s.account_id
        WHERE s.token_hash = $1
          AND s.revoked_at IS NULL
          AND s.expires_at > now()
          AND a.email_verified_at IS NOT NULL
          AND a.deleted_at IS NULL`,
      [tokenHash],
    );
    return result.rows[0]?.account_id ?? null;
  };
}

export function createSessionRevoker(database: Queryable): RevokeSession {
  return async (accountId, authorization) => {
    const token = sessionTokenFromHeader(authorization);
    if (!token) return false;

    const tokenHash = createHash("sha256").update(token).digest("hex");
    const result = await database.query(
      `UPDATE account_sessions AS s
          SET revoked_at = now()
         FROM accounts AS a
        WHERE s.account_id = $1
          AND s.account_id = a.id
          AND s.token_hash = $2
          AND s.revoked_at IS NULL
          AND s.expires_at > now()
          AND a.email_verified_at IS NOT NULL
          AND a.deleted_at IS NULL
        RETURNING s.id`,
      [accountId, tokenHash],
    );
    return result.rows.length === 1;
  };
}

function sessionTokenFromHeader(authorization: string | undefined): string | null {
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/);
  const token = match?.[1];
  return token && SESSION_TOKEN.test(token) ? token : null;
}
