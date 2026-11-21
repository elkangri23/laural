CREATE TABLE request_rate_limits (
  scope text NOT NULL CHECK (char_length(scope) BETWEEN 1 AND 64),
  key_digest char(64) NOT NULL CHECK (key_digest ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count BETWEEN 1 AND 1001),
  PRIMARY KEY (scope, key_digest)
);
CREATE INDEX request_rate_limits_window_idx ON request_rate_limits(window_started_at);
