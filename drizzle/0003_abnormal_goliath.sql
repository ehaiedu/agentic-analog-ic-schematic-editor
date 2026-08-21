CREATE TABLE `project_recovery` (
	`project_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`document_json` text NOT NULL,
	`base_storage_revision` integer NOT NULL,
	`design_revision` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_recovery_owner_idx` ON `project_recovery` (`owner_id`);