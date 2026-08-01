ALTER TABLE `versions` ADD `records` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `versions` ADD `prompt` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `versions` ADD `provider` text;--> statement-breakpoint
ALTER TABLE `versions` ADD `model` text;--> statement-breakpoint
ALTER TABLE `versions` ADD `warning` text;--> statement-breakpoint
ALTER TABLE `versions` ADD `stages` text DEFAULT '[]' NOT NULL;