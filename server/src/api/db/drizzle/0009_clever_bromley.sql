CREATE TABLE "world_lives" (
	"life_id" text PRIMARY KEY NOT NULL,
	"player_id" text NOT NULL,
	"shard_id" text NOT NULL,
	"status" text DEFAULT 'alive' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"position" json NOT NULL,
	"health" integer DEFAULT 100 NOT NULL,
	"boost" integer DEFAULT 0 NOT NULL,
	"carried_items" json NOT NULL,
	"started_at" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"died_at" timestamp with time zone,
	"extracted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "world_settlements" (
	"settlement_id" text PRIMARY KEY NOT NULL,
	"player_id" text NOT NULL,
	"shard_id" text NOT NULL,
	"life_id" text NOT NULL,
	"extraction_id" text NOT NULL,
	"secured_items" json NOT NULL,
	"reward_points" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "world_shards" (
	"shard_id" text PRIMARY KEY NOT NULL,
	"world_id" text NOT NULL,
	"map_id" integer NOT NULL,
	"seed" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"world_revision" integer DEFAULT 0 NOT NULL,
	"snapshot_revision" integer DEFAULT 0 NOT NULL,
	"safe_zone" json NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "world_item_instances" ADD COLUMN IF NOT EXISTS "life_id" text;--> statement-breakpoint
ALTER TABLE "world_item_instances" ADD CONSTRAINT "world_item_instances_life_id_world_lives_life_id_fk" FOREIGN KEY ("life_id") REFERENCES "public"."world_lives"("life_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_lives" ADD CONSTRAINT "world_lives_player_id_users_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "world_lives" ADD CONSTRAINT "world_lives_shard_id_world_shards_shard_id_fk" FOREIGN KEY ("shard_id") REFERENCES "public"."world_shards"("shard_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "world_settlements" ADD CONSTRAINT "world_settlements_player_id_users_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "world_settlements" ADD CONSTRAINT "world_settlements_shard_id_world_shards_shard_id_fk" FOREIGN KEY ("shard_id") REFERENCES "public"."world_shards"("shard_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "world_settlements" ADD CONSTRAINT "world_settlements_life_id_world_lives_life_id_fk" FOREIGN KEY ("life_id") REFERENCES "public"."world_lives"("life_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "world_items_life_idx" ON "world_item_instances" USING btree ("life_id");--> statement-breakpoint
CREATE INDEX "world_lives_player_status_idx" ON "world_lives" USING btree ("player_id","status");--> statement-breakpoint
CREATE INDEX "world_lives_shard_status_idx" ON "world_lives" USING btree ("shard_id","status");--> statement-breakpoint
CREATE INDEX "world_settlements_player_created_idx" ON "world_settlements" USING btree ("player_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "world_settlements_player_extraction_uq" ON "world_settlements" USING btree ("player_id","extraction_id");
