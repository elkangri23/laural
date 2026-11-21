CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text,
  email_verified_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(email) <= 320)
);
CREATE UNIQUE INDEX accounts_email_lower_idx ON accounts (lower(email));

CREATE TABLE account_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_sessions_account_id_idx ON account_sessions(account_id);
CREATE INDEX account_sessions_expiry_idx ON account_sessions(expires_at);

CREATE TABLE account_preferences (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  snapshot jsonb NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE preference_idempotency (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  idempotency_key varchar(128) NOT NULL,
  payload_digest char(64) NOT NULL,
  snapshot jsonb NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, idempotency_key)
);
CREATE INDEX preference_idempotency_created_idx ON preference_idempotency(created_at);
