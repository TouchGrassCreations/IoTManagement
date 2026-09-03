CREATE TABLE identification_rate_limits (
  owner_id TEXT NOT NULL,
  window_name TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, window_name, window_start)
);
--> statement-breakpoint
CREATE INDEX idx_identification_rate_limits_expiry ON identification_rate_limits(expires_at);
