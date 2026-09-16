CREATE TABLE `clients` (
	`owner` text NOT NULL,
	`name` text NOT NULL,
	PRIMARY KEY(`owner`, `name`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`owner` text NOT NULL,
	`client` text NOT NULL,
	`name` text NOT NULL,
	PRIMARY KEY(`owner`, `client`, `name`)
);
--> statement-breakpoint
INSERT OR IGNORE INTO clients (owner, name)
SELECT owner, trim(json_extract(payload, '$.client')) FROM expenses
WHERE trim(coalesce(json_extract(payload, '$.client'), '')) <> '';
--> statement-breakpoint
INSERT OR IGNORE INTO projects (owner, client, name)
SELECT owner, trim(json_extract(payload, '$.client')), trim(json_extract(payload, '$.project')) FROM expenses
WHERE trim(coalesce(json_extract(payload, '$.client'), '')) <> ''
AND trim(coalesce(json_extract(payload, '$.project'), '')) <> '';
