ALTER TABLE native_auth_flows
  ADD COLUMN mfa_account_id uuid REFERENCES accounts(id) ON DELETE CASCADE;

CREATE TABLE account_totp_enrollments (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  encrypted_secret jsonb NOT NULL,
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE account_totp_factors (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  encrypted_secret jsonb NOT NULL,
  last_used_counter bigint NOT NULL DEFAULT -1 CHECK (last_used_counter >= -1),
  enabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE account_recovery_codes (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  verifier_digest char(64) NOT NULL CHECK (verifier_digest ~ '^[a-f0-9]{64}$'),
  is_active boolean NOT NULL DEFAULT true,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, verifier_digest)
);
CREATE INDEX account_recovery_codes_account_idx ON account_recovery_codes(account_id) WHERE is_active AND consumed_at IS NULL;
