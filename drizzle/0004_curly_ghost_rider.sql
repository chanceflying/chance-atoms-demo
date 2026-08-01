CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`provider` text,
	`model` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_chat_messages_project_created` ON `chat_messages` (`project_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `projects` ADD `kind` text DEFAULT 'web_app' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `memory_enabled` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `memory_content` text DEFAULT '' NOT NULL;