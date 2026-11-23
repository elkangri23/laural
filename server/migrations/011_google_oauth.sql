CREATE TABLE account_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider varchar(32) NOT NULL CHECK (provider = 'google'),
  subject varchar(255) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, subject),
  UNIQUE (account_id, provider)
);
CREATE INDEX account_identities_account_id_idx ON account_identities(account_id);

CREATE TABLE google_oauth_transactions (
  state_digest char(64) PRIMARY KEY CHECK (state_digest ~ '^[a-f0-9]{64}$'),
  cookie_digest char(64) NOT NULL REFERENCES native_auth_flows(cookie_digest) ON DELETE CASCADE CHECK (cookie_digest ~ '^[a-f0-9]{64}$'),
  csrf_digest char(64) NOT NULL CHECK (csrf_digest ~ '^[a-f0-9]{64}$'),
  nonce_digest char(64) NOT NULL CHECK (nonce_digest ~ '^[a-f0-9]{64}$'),
  code_verifier varchar(128) NOT NULL CHECK (length(code_verifier) BETWEEN 43 AND 128),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX google_oauth_transactions_expiry_idx ON google_oauth_transactions(expires_at);
