CREATE TABLE `agent_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`active_family` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_conversations_project_updated_idx` ON `agent_conversations` (`project_id`,`updated_at`);
--> statement-breakpoint
CREATE INDEX `agent_conversations_owner_idx` ON `agent_conversations` (`owner_id`);
--> statement-breakpoint
CREATE TABLE `agent_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`project_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`role` text NOT NULL,
	`kind` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'info' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`code` text DEFAULT '' NOT NULL,
	`metrics_json` text DEFAULT '{}' NOT NULL,
	`evidence_level` text DEFAULT '' NOT NULL,
	`model_id` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `agent_conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_messages_conversation_sequence_unique` ON `agent_messages` (`conversation_id`,`sequence`);
--> statement-breakpoint
CREATE INDEX `agent_messages_project_idx` ON `agent_messages` (`project_id`);
--> statement-breakpoint
CREATE INDEX `agent_messages_owner_idx` ON `agent_messages` (`owner_id`);
--> statement-breakpoint
CREATE TABLE `agent_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`message_id` text,
	`project_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`direction` text NOT NULL,
	`object_key` text NOT NULL,
	`file_name` text NOT NULL,
	`media_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`width` integer DEFAULT 0 NOT NULL,
	`height` integer DEFAULT 0 NOT NULL,
	`sha256` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `agent_conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `agent_messages`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_attachments_conversation_idx` ON `agent_attachments` (`conversation_id`);
--> statement-breakpoint
CREATE INDEX `agent_attachments_message_idx` ON `agent_attachments` (`message_id`);
--> statement-breakpoint
CREATE INDEX `agent_attachments_project_idx` ON `agent_attachments` (`project_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_attachments_object_key_unique` ON `agent_attachments` (`object_key`);
