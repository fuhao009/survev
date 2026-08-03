ALTER TABLE "users" ADD COLUMN "login_username" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_login_username_unique" UNIQUE("login_username");