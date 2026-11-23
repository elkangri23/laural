ALTER TABLE account_recovery_cases
  ADD COLUMN recovery_completed_at timestamptz;

CREATE TABLE account_recovery_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES account_recovery_cases(id) ON DELETE CASCADE,
  token_digest char(64) NOT NULL UNIQUE CHECK (token_digest ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX account_recovery_grants_one_open_case_idx
  ON account_recovery_grants(case_id) WHERE consumed_at IS NULL;
CREATE INDEX account_recovery_grants_expiry_idx ON account_recovery_grants(expires_at);

CREATE TABLE account_recovery_grant_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL UNIQUE REFERENCES account_recovery_grants(id) ON DELETE CASCADE,
  encrypted_ticket jsonb,
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  delivered_at timestamptz,
  abandoned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT (delivered_at IS NOT NULL AND abandoned_at IS NOT NULL)),
  CHECK ((delivered_at IS NULL AND abandoned_at IS NULL) OR encrypted_ticket IS NULL)
);
CREATE INDEX account_recovery_grant_outbox_pending_idx
  ON account_recovery_grant_outbox(next_attempt_at, created_at)
  WHERE delivered_at IS NULL AND abandoned_at IS NULL;

CREATE TABLE account_recovery_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL UNIQUE REFERENCES account_recovery_grants(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  cookie_digest char(64) NOT NULL UNIQUE CHECK (cookie_digest ~ '^[a-f0-9]{64}$'),
  csrf_digest char(64) NOT NULL CHECK (csrf_digest ~ '^[a-f0-9]{64}$'),
  encrypted_secret jsonb NOT NULL,
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_recovery_enrollments_expiry_idx ON account_recovery_enrollments(expires_at);

ALTER TABLE account_security_email_outbox
  DROP CONSTRAINT account_security_email_outbox_event_type_check;
ALTER TABLE account_security_email_outbox
  ADD CONSTRAINT account_security_email_outbox_event_type_check
  CHECK (event_type IN ('totp_enabled', 'recovery_codes_rotated', 'totp_disabled', 'passkey_added', 'passkey_removed', 'account_recovered'));
