CREATE TABLE native_auth_flows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cookie_digest char(64) NOT NULL UNIQUE CHECK (cookie_digest ~ '^[a-f0-9]{64}$'),
  csrf_digest char(64) NOT NULL CHECK (csrf_digest ~ '^[a-f0-9]{64}$'),
  redirect_uri text NOT NULL,
  state varchar(128) NOT NULL,
  code_challenge char(43) NOT NULL,
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX native_auth_flows_expiry_idx ON native_auth_flows(expires_at);

CREATE TABLE native_authorization_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_digest char(64) NOT NULL UNIQUE CHECK (code_digest ~ '^[a-f0-9]{64}$'),
  flow_id uuid NOT NULL UNIQUE REFERENCES native_auth_flows(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  code_challenge char(43) NOT NULL,
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX native_authorization_codes_expiry_idx ON native_authorization_codes(expires_at);
