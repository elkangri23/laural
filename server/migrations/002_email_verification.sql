ALTER TABLE accounts
  ADD COLUMN display_name text NOT NULL DEFAULT 'Usuario';
ALTER TABLE accounts
  ALTER COLUMN display_name DROP DEFAULT;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_display_name_length CHECK (char_length(display_name) BETWEEN 1 AND 80);

CREATE TABLE email_verification_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  verifier_digest char(64) NOT NULL CHECK (verifier_digest ~ '^[a-f0-9]{64}$'),
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_verification_codes_account_created_idx
  ON email_verification_codes(account_id, created_at DESC);
