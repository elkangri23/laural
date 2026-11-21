CREATE TABLE account_password_reset_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  verifier_digest char(64) NOT NULL CHECK (verifier_digest ~ '^[a-f0-9]{64}$'),
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_password_reset_codes_account_created_idx
  ON account_password_reset_codes(account_id, created_at DESC);
