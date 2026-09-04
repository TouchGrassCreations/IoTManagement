ALTER TABLE inventory_parts ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'legacy-shared-cabinet';
--> statement-breakpoint
ALTER TABLE identification_scans ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'legacy-shared-cabinet';
--> statement-breakpoint
ALTER TABLE identification_events ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'legacy-shared-cabinet';
--> statement-breakpoint
ALTER TABLE inventory_adjustment_events ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'legacy-shared-cabinet';
--> statement-breakpoint

UPDATE identification_scans SET owner_id = user_id WHERE user_id IS NOT NULL AND user_id <> '';
--> statement-breakpoint

DROP INDEX IF EXISTS idx_inventory_identity;
--> statement-breakpoint
CREATE UNIQUE INDEX idx_inventory_identity ON inventory_parts(owner_id, normalized_name, model_key);
--> statement-breakpoint
CREATE INDEX idx_identification_scans_owner ON identification_scans(owner_id, created_at);
--> statement-breakpoint
CREATE INDEX idx_identification_events_owner ON identification_events(owner_id, created_at);
--> statement-breakpoint
CREATE INDEX idx_inventory_adjustment_events_owner ON inventory_adjustment_events(owner_id, created_at);
