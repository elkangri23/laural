CREATE TABLE account_passkeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE CHECK (length(credential_id) BETWEEN 1 AND 1024),
  public_key bytea NOT NULL,
  sign_count bigint NOT NULL DEFAULT 0 CHECK (sign_count >= 0),
  transports text[] NOT NULL DEFAULT '{}',
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  device_type text NOT NULL CHECK (device_type IN ('singleDevice', 'multiDevice')),
  backed_up boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX account_passkeys_account_id_idx ON account_passkeys(account_id);

CREATE TABLE passkey_login_challenges (
  flow_id uuid PRIMARY KEY REFERENCES native_auth_flows(id) ON DELETE CASCADE,
  challenge varchar(128) NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX passkey_login_challenges_expiry_idx ON passkey_login_challenges(expires_at);

CREATE TABLE passkey_management_tickets (
  ticket_digest char(64) PRIMARY KEY CHECK (ticket_digest ~ '^[a-f0-9]{64}$'),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX passkey_management_tickets_expiry_idx ON passkey_management_tickets(expires_at);

CREATE TABLE passkey_management_sessions (
  cookie_digest char(64) PRIMARY KEY CHECK (cookie_digest ~ '^[a-f0-9]{64}$'),
  csrf_digest char(64) NOT NULL CHECK (csrf_digest ~ '^[a-f0-9]{64}$'),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX passkey_management_sessions_expiry_idx ON passkey_management_sessions(expires_at);

CREATE TABLE passkey_management_challenges (
  cookie_digest char(64) PRIMARY KEY REFERENCES passkey_management_sessions(cookie_digest) ON DELETE CASCADE,
  csrf_digest char(64) NOT NULL CHECK (csrf_digest ~ '^[a-f0-9]{64}$'),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  challenge varchar(128) NOT NULL,
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
