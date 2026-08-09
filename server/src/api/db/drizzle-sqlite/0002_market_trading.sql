CREATE TABLE `market_intents` (
	`intent_id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`buyer_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`amount` integer NOT NULL,
	`client_request_id` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `market_listings`(`listing_id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`buyer_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `market_intents_listing_status_idx` ON `market_intents` (`listing_id`,`status`);--> statement-breakpoint
CREATE INDEX `market_intents_buyer_status_idx` ON `market_intents` (`buyer_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `market_intents_buyer_request_uq` ON `market_intents` (`buyer_id`,`client_request_id`);--> statement-breakpoint
CREATE TABLE `market_listings` (
	`listing_id` text PRIMARY KEY NOT NULL,
	`seller_id` text NOT NULL,
	`item_instance_id` text NOT NULL,
	`mode` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`price` integer,
	`current_price` integer,
	`client_request_id` text NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`seller_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`item_instance_id`) REFERENCES `world_item_instances`(`instance_id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `market_listings_status_expires_idx` ON `market_listings` (`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `market_listings_item_status_idx` ON `market_listings` (`item_instance_id`,`status`);--> statement-breakpoint
CREATE INDEX `market_listings_seller_status_idx` ON `market_listings` (`seller_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `market_listings_seller_request_uq` ON `market_listings` (`seller_id`,`client_request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `market_listings_item_active_uq` ON `market_listings` (`item_instance_id`) WHERE `status` = 'active';--> statement-breakpoint
CREATE TABLE `market_trades` (
	`trade_id` text PRIMARY KEY NOT NULL,
	`listing_id` text NOT NULL,
	`item_instance_id` text NOT NULL,
	`buyer_id` text NOT NULL,
	`seller_id` text NOT NULL,
	`price` integer NOT NULL,
	`fee` integer NOT NULL,
	`seller_proceeds` integer NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`listing_id`) REFERENCES `market_listings`(`listing_id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`item_instance_id`) REFERENCES `world_item_instances`(`instance_id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`buyer_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`seller_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `market_trades_buyer_created_idx` ON `market_trades` (`buyer_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `market_trades_seller_created_idx` ON `market_trades` (`seller_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `market_trades_listing_idx` ON `market_trades` (`listing_id`);--> statement-breakpoint
CREATE TABLE `market_wallet_holds` (
	`hold_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`listing_id` text NOT NULL,
	`intent_id` text,
	`amount` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`listing_id`) REFERENCES `market_listings`(`listing_id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`intent_id`) REFERENCES `market_intents`(`intent_id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `market_wallet_holds_user_status_idx` ON `market_wallet_holds` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `market_wallet_holds_listing_status_idx` ON `market_wallet_holds` (`listing_id`,`status`);--> statement-breakpoint
CREATE INDEX `market_wallet_holds_intent_idx` ON `market_wallet_holds` (`intent_id`);
