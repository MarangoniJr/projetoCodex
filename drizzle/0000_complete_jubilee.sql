CREATE TABLE `expenses` (
	`owner` text NOT NULL,
	`id` text NOT NULL,
	`date` text NOT NULL,
	`payload` text NOT NULL,
	`receipt_key` text,
	PRIMARY KEY(`owner`, `id`)
);
--> statement-breakpoint
CREATE INDEX `idx_expenses_owner_date` ON `expenses` (`owner`,`date`);--> statement-breakpoint
CREATE TABLE `reports` (
	`owner` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL
);
