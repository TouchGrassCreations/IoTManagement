CREATE TABLE `inventory_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`model` text,
	`model_key` text NOT NULL,
	`category` text NOT NULL,
	`quantity` integer DEFAULT 0 NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_identity` ON `inventory_parts` (`normalized_name`,`model_key`);
--> statement-breakpoint
CREATE TABLE `identification_scans` (
	`id` text PRIMARY KEY NOT NULL,
	`confirmation_token_hash` text NOT NULL,
	`user_id` text,
	`provider` text NOT NULL,
	`provider_model` text NOT NULL,
	`accepted_detection_count` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `identification_scans_confirmation_token_hash_unique` ON `identification_scans` (`confirmation_token_hash`);
--> statement-breakpoint
CREATE TABLE `identification_events` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_id` text NOT NULL,
	`inventory_part_id` text NOT NULL,
	`source` text NOT NULL,
	`detected_name` text,
	`detected_model` text,
	`confirmed_name` text NOT NULL,
	`confirmed_model` text,
	`quantity_added` integer NOT NULL,
	`confidence` integer,
	`visible_markings` text DEFAULT '[]' NOT NULL,
	`bounding_box` text,
	`alternatives` text DEFAULT '[]' NOT NULL,
	`was_edited` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_identification_events_scan_id` ON `identification_events` (`scan_id`);
