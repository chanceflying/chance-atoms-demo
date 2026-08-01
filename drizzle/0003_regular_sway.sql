ALTER TABLE `versions` ADD `build_plan` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `versions` ADD `reasoning_summary` text DEFAULT '[]' NOT NULL;