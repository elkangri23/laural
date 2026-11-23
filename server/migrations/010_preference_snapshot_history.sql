CREATE TABLE preference_snapshot_history (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  revision bigint NOT NULL CHECK (revision > 0),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, revision)
);
CREATE INDEX preference_snapshot_history_created_idx
  ON preference_snapshot_history (account_id, revision DESC);
