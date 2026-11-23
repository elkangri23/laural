CREATE TABLE account_recovery_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  verifier_digest char(64) NOT NULL CHECK (verifier_digest ~ '^[a-f0-9]{64}$'),
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  mailbox_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_recovery_cases_account_created_idx
  ON account_recovery_cases(account_id, created_at DESC);

CREATE TABLE account_recovery_notice_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL UNIQUE REFERENCES account_recovery_cases(id) ON DELETE CASCADE,
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  delivered_at timestamptz,
  abandoned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_recovery_notice_pending_idx
  ON account_recovery_notice_outbox(next_attempt_at, created_at)
  WHERE delivered_at IS NULL AND abandoned_at IS NULL;
