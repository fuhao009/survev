CREATE TABLE `banned_ips` (
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`expires_in` integer NOT NULL,
	`encoded_ip` text PRIMARY KEY NOT NULL,
	`permanent` integer DEFAULT false NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`banned_by` text DEFAULT 'admin' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ip_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`region` text NOT NULL,
	`game_id` text NOT NULL,
	`map_id` integer NOT NULL,
	`username` text NOT NULL,
	`user_id` text DEFAULT '',
	`encoded_ip` text NOT NULL,
	`team_mode` integer DEFAULT 1 NOT NULL,
	`ip` text NOT NULL,
	`find_game_ip` text NOT NULL,
	`find_game_encoded_ip` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `name_created_at_idx` ON `ip_logs` (`username`,`created_at`);--> statement-breakpoint
CREATE TABLE `items` (
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`time_acquired` integer NOT NULL,
	`source` text DEFAULT 'unlock_new_account' NOT NULL,
	`status` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_items_user_type` ON `items` (`user_id`,`type`);--> statement-breakpoint
CREATE TABLE `match_data` (
	`user_id` text DEFAULT '',
	`user_banned` integer DEFAULT false,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`region` text NOT NULL,
	`map_id` integer NOT NULL,
	`game_id` text NOT NULL,
	`map_seed` integer NOT NULL,
	`username` text NOT NULL,
	`player_id` integer NOT NULL,
	`team_mode` integer NOT NULL,
	`team_count` integer NOT NULL,
	`team_total` integer NOT NULL,
	`team_id` integer NOT NULL,
	`time_alive` integer NOT NULL,
	`rank` integer NOT NULL,
	`died` integer NOT NULL,
	`kills` integer NOT NULL,
	`team_kills` integer DEFAULT 0 NOT NULL,
	`damage_dealt` integer NOT NULL,
	`damage_taken` integer NOT NULL,
	`killer_id` integer NOT NULL,
	`killed_ids` text NOT NULL,
	`role` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_match_data_user_stats` ON `match_data` (`user_id`,`team_mode`,`rank`,`kills`,`damage_dealt`,`time_alive`);--> statement-breakpoint
CREATE INDEX `idx_game_id` ON `match_data` (`game_id`);--> statement-breakpoint
CREATE INDEX `idx_user_id` ON `match_data` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_match_data_team_query` ON `match_data` (`team_mode`,`map_id`,`created_at`,`game_id`,`team_id`,`region`,`kills`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_pass` (
	`user_id` text NOT NULL,
	`pass_type` text DEFAULT 'pass_survivr1' NOT NULL,
	`total_xp` integer DEFAULT 0 NOT NULL,
	`unlocks` text DEFAULT '{}' NOT NULL,
	`new_items` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_pass_user_type` ON `user_pass` (`user_id`,`pass_type`);--> statement-breakpoint
CREATE TABLE `user_quest` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`idx` integer NOT NULL,
	`quest_type` text NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`target` integer NOT NULL,
	`complete` integer DEFAULT false NOT NULL,
	`rerolled` integer DEFAULT false NOT NULL,
	`time_acquired` integer NOT NULL,
	`next_refresh_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_quest_user_idx` ON `user_quest` (`user_id`,`idx`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`auth_id` text NOT NULL,
	`login_username` text,
	`password_hash` text,
	`slug` text NOT NULL,
	`banned` integer DEFAULT false NOT NULL,
	`ban_reason` text DEFAULT '' NOT NULL,
	`banned_by` text DEFAULT '' NOT NULL,
	`username` text DEFAULT '' NOT NULL,
	`username_set` integer DEFAULT false NOT NULL,
	`user_created` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`last_username_change_time` integer,
	`linked` integer DEFAULT false NOT NULL,
	`linked_google` integer DEFAULT false NOT NULL,
	`linked_discord` integer DEFAULT false NOT NULL,
	`loadout` text DEFAULT '{"outfit":"outfitBase","melee":"fists","heal":"heal_basic","boost":"boost_basic","player_icon":"","crosshair":{"type":"crosshair_default","color":16777215,"size":"1.00","stroke":"0.00"},"emotes":["emote_happyface","emote_thumbsup","emote_surviv","emote_sadface","",""]}' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_login_username_unique` ON `users` (`login_username`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_slug_unique` ON `users` (`slug`);--> statement-breakpoint
CREATE TABLE `wallet_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`amount` integer NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `wallet_transactions_user_created_at_idx` ON `wallet_transactions` (`user_id`,`created_at`,`id`);--> statement-breakpoint
CREATE TABLE `world_item_instances` (
	`instance_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`life_id` text,
	`type` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`durability` integer NOT NULL,
	`durability_max` integer NOT NULL,
	`state` text DEFAULT 'stash' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`life_id`) REFERENCES `world_lives`(`life_id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `world_item_instances_user_state_idx` ON `world_item_instances` (`user_id`,`state`);--> statement-breakpoint
CREATE INDEX `world_items_life_idx` ON `world_item_instances` (`life_id`);--> statement-breakpoint
CREATE TABLE `world_lives` (
	`life_id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`shard_id` text NOT NULL,
	`status` text DEFAULT 'alive' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`position` text NOT NULL,
	`health` integer DEFAULT 100 NOT NULL,
	`boost` integer DEFAULT 0 NOT NULL,
	`carried_items` text NOT NULL,
	`started_at` integer NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`died_at` integer,
	`extracted_at` integer,
	FOREIGN KEY (`player_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`shard_id`) REFERENCES `world_shards`(`shard_id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `world_lives_player_status_idx` ON `world_lives` (`player_id`,`status`);--> statement-breakpoint
CREATE INDEX `world_lives_shard_status_idx` ON `world_lives` (`shard_id`,`status`);--> statement-breakpoint
CREATE TABLE `world_settlements` (
	`settlement_id` text PRIMARY KEY NOT NULL,
	`player_id` text NOT NULL,
	`shard_id` text NOT NULL,
	`life_id` text NOT NULL,
	`extraction_id` text NOT NULL,
	`secured_items` text NOT NULL,
	`reward_points` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`player_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`shard_id`) REFERENCES `world_shards`(`shard_id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`life_id`) REFERENCES `world_lives`(`life_id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `world_settlements_player_created_idx` ON `world_settlements` (`player_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `world_settlements_player_extraction_uq` ON `world_settlements` (`player_id`,`extraction_id`);--> statement-breakpoint
CREATE TABLE `world_shards` (
	`shard_id` text PRIMARY KEY NOT NULL,
	`world_id` text NOT NULL,
	`map_id` integer NOT NULL,
	`seed` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`world_revision` integer DEFAULT 0 NOT NULL,
	`snapshot_revision` integer DEFAULT 0 NOT NULL,
	`safe_zone` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
