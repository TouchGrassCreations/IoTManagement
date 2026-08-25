ALTER TABLE inventory_parts ADD COLUMN image TEXT;
--> statement-breakpoint
ALTER TABLE identification_events ADD COLUMN captured_image INTEGER NOT NULL DEFAULT 0;
