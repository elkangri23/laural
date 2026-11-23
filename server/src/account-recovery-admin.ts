import type { Pool } from "pg";

export type RecoveryEvidence = "google_identity" | "existing_mfa" | "trusted_session" | "other_independent" | "insufficient";
export type RecoveryDecision = "approved" | "denied";
export type PendingRecoveryCase = { id: string; account_email: string; created_at: Date; mailbox_verified_at: Date };

const INDEPENDENT_EVIDENCE = new Set<RecoveryEvidence>([
  "google_identity", "existing_mfa", "trusted_session", "other_independent",
]);

export async function listPendingRecoveryCases(pool: Pick<Pool, "query">): Promise<PendingRecoveryCase[]> {
  const result = await pool.query<PendingRecoveryCase>(
    `SELECT c.id, a.email AS account_email, c.created_at, c.mailbox_verified_at
       FROM account_recovery_cases c JOIN accounts a ON a.id = c.account_id
      WHERE c.mailbox_verified_at IS NOT NULL AND c.review_decision IS NULL
        AND c.consumed_at IS NOT NULL AND a.deleted_at IS NULL
      ORDER BY c.created_at, c.id LIMIT 100`,
  );
  return result.rows;
}

export async function recordRecoveryDecision(
  pool: Pick<Pool, "query">,
  input: { caseId: string; decision: RecoveryDecision; evidence: RecoveryEvidence; operator: string },
): Promise<boolean> {
  if (!isUuid(input.caseId) || !isDecision(input.decision) || !isEvidence(input.evidence) || !isOperator(input.operator)) return false;
  if (input.decision === "approved" && !INDEPENDENT_EVIDENCE.has(input.evidence)) return false;
  const result = await pool.query(
    `UPDATE account_recovery_cases
        SET review_decision = $2, evidence_category = $3, reviewed_by = $4, reviewed_at = now()
      WHERE id = $1 AND mailbox_verified_at IS NOT NULL AND consumed_at IS NOT NULL
        AND review_decision IS NULL
        AND EXISTS (SELECT 1 FROM accounts a WHERE a.id = account_recovery_cases.account_id AND a.deleted_at IS NULL)`,
    [input.caseId, input.decision, input.evidence, input.operator],
  );
  return result.rowCount === 1;
}

export function isOperator(value: unknown): value is string {
  return typeof value === "string" && /^[a-z_][a-z0-9_.-]{0,63}$/iu.test(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function isDecision(value: unknown): value is RecoveryDecision {
  return value === "approved" || value === "denied";
}

function isEvidence(value: unknown): value is RecoveryEvidence {
  return value === "google_identity" || value === "existing_mfa" || value === "trusted_session"
    || value === "other_independent" || value === "insufficient";
}
