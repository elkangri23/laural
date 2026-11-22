CREATE TABLE account_security_email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  recipient_email text NOT NULL CHECK (length(recipient_email) <= 320),
  event_type text NOT NULL CHECK (event_type IN ('totp_enabled', 'recovery_codes_rotated', 'totp_disabled')),
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8),
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  delivered_at timestamptz,
  abandoned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT (delivered_at IS NOT NULL AND abandoned_at IS NOT NULL))
);

CREATE INDEX account_security_email_outbox_pending_idx
  ON account_security_email_outbox (available_at, created_at)
  WHERE delivered_at IS NULL AND abandoned_at IS NULL;
