CREATE TABLE `baby` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`nickname` varchar(32) NOT NULL,
	`gender` varchar(8) NOT NULL,
	`birth_date` char(10) NOT NULL,
	`birth_height_cm` decimal(5,1),
	`birth_weight_kg` decimal(5,2),
	`birth_head_cm` decimal(5,1),
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `baby_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `backup_runs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`date` char(10) NOT NULL,
	`cos_key` varchar(255) NOT NULL,
	`size` int NOT NULL,
	`created_at` bigint NOT NULL,
	CONSTRAINT `backup_runs_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_date` UNIQUE(`date`)
);
--> statement-breakpoint
CREATE TABLE `care_records` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`client_id` char(36) NOT NULL,
	`type` varchar(16) NOT NULL,
	`start_at` bigint NOT NULL,
	`end_at` bigint,
	`payload` json NOT NULL,
	`note` varchar(500),
	`created_by` bigint unsigned NOT NULL,
	`updated_by` bigint unsigned NOT NULL,
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	`deleted_at` bigint,
	`running_type` varchar(16) GENERATED ALWAYS AS ((case when end_at is null and deleted_at is null and type in ('breastfeed', 'sleep') then type end)) VIRTUAL,
	CONSTRAINT `care_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_client_id` UNIQUE(`client_id`),
	CONSTRAINT `uk_running_type` UNIQUE(`running_type`)
);
--> statement-breakpoint
CREATE TABLE `files` (
	`id` char(36) NOT NULL,
	`cloud_file_id` varchar(512) NOT NULL,
	`size` int NOT NULL,
	`mime` varchar(64) NOT NULL,
	`created_by` bigint unsigned NOT NULL,
	`created_at` bigint NOT NULL,
	`deleted_at` bigint,
	CONSTRAINT `files_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_cloud_file_id` UNIQUE(`cloud_file_id`)
);
--> statement-breakpoint
CREATE TABLE `growth_records` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`measure_date` char(10) NOT NULL,
	`height_cm` decimal(5,1),
	`weight_kg` decimal(5,2),
	`head_cm` decimal(5,1),
	`note` varchar(500),
	`created_by` bigint unsigned NOT NULL,
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	`deleted_at` bigint,
	CONSTRAINT `growth_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `inventory_items` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`name` varchar(64) NOT NULL,
	`category` varchar(16) NOT NULL,
	`spec` varchar(32),
	`unit` varchar(8) NOT NULL,
	`quantity` int NOT NULL DEFAULT 0,
	`low_threshold` int NOT NULL DEFAULT 0,
	`archived` tinyint NOT NULL DEFAULT 0,
	`note` varchar(500),
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `inventory_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `inventory_logs` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`item_id` bigint unsigned NOT NULL,
	`action` varchar(8) NOT NULL,
	`delta` int NOT NULL,
	`quantity_before` int NOT NULL,
	`quantity_after` int NOT NULL,
	`price_cents` int,
	`channel` varchar(32),
	`occurred_at` bigint NOT NULL,
	`note` varchar(500),
	`created_by` bigint unsigned NOT NULL,
	`created_at` bigint NOT NULL,
	CONSTRAINT `inventory_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `milestone_photos` (
	`milestone_id` bigint unsigned NOT NULL,
	`file_id` char(36) NOT NULL,
	`sort` int NOT NULL,
	CONSTRAINT `milestone_photos_milestone_id_file_id_pk` PRIMARY KEY(`milestone_id`,`file_id`)
);
--> statement-breakpoint
CREATE TABLE `milestones` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`date` char(10) NOT NULL,
	`title` varchar(64) NOT NULL,
	`description` varchar(1000),
	`created_by` bigint unsigned NOT NULL,
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	`deleted_at` bigint,
	CONSTRAINT `milestones_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`openid` varchar(64) NOT NULL,
	`display_name` varchar(32) NOT NULL,
	`enabled` tinyint NOT NULL DEFAULT 1,
	`created_at` bigint NOT NULL,
	`updated_at` bigint NOT NULL,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `uk_openid` UNIQUE(`openid`)
);
--> statement-breakpoint
CREATE INDEX `idx_deleted_start` ON `care_records` (`deleted_at`,`start_at`);--> statement-breakpoint
CREATE INDEX `idx_type_start` ON `care_records` (`type`,`start_at`);--> statement-breakpoint
CREATE INDEX `idx_measure_date` ON `growth_records` (`measure_date`);--> statement-breakpoint
CREATE INDEX `idx_item_id` ON `inventory_logs` (`item_id`,`id`);--> statement-breakpoint
CREATE INDEX `idx_date` ON `milestones` (`date`);