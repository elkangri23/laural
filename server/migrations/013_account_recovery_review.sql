ALTER TABLE account_recovery_cases
  ADD COLUMN review_decision text CHECK (review_decision IN ('approved', 'denied')),
  ADD COLUMN evidence_category text CHECK (evidence_category IN ('google_identity', 'existing_mfa', 'trusted_session', 'other_independent', 'insufficient')),
  ADD COLUMN reviewed_by text CHECK (reviewed_by IS NULL OR reviewed_by ~* '^[a-z_][a-z0-9_.-]{0,63}$'),
  ADD COLUMN reviewed_at timestamptz,
  ADD CONSTRAINT account_recovery_review_complete CHECK (
    (review_decision IS NULL AND evidence_category IS NULL AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (review_decision IS NOT NULL AND evidence_category IS NOT NULL AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  ),
  ADD CONSTRAINT account_recovery_approval_has_independent_evidence CHECK (
    review_decision IS DISTINCT FROM 'approved' OR evidence_category IN ('google_identity', 'existing_mfa', 'trusted_session', 'other_independent')
  );

CREATE INDEX account_recovery_cases_review_queue_idx
  ON account_recovery_cases(created_at, id)
  WHERE mailbox_verified_at IS NOT NULL AND review_decision IS NULL;
