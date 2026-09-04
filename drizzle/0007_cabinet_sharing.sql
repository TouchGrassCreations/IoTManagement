CREATE TABLE cabinets (
  owner_id TEXT PRIMARY KEY NOT NULL,
  label TEXT,
  visibility TEXT NOT NULL DEFAULT 'private',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE INDEX idx_cabinets_visibility ON cabinets(visibility);
