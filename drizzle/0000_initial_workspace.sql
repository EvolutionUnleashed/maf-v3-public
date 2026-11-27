CREATE TABLE `build_artifacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspaceId` integer NOT NULL,
	`stepKey` text(32) NOT NULL,
	`artifactType` text(64) NOT NULL,
	`content` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`createdAt` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	`updatedAt` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `build_artifacts_workspace_step_unique` ON `build_artifacts` (`workspaceId`,`stepKey`);--> statement-breakpoint
CREATE TABLE `build_sections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspaceId` integer NOT NULL,
	`sectionKey` text(32) NOT NULL,
	`status` text DEFAULT 'locked' NOT NULL,
	`createdAt` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	`updatedAt` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "build_sections_status_check" CHECK("build_sections"."status" in ('locked', 'in_progress', 'approved', 'amber'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `build_sections_workspace_section_unique` ON `build_sections` (`workspaceId`,`sectionKey`);--> statement-breakpoint
CREATE TABLE `build_sub_steps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspaceId` integer NOT NULL,
	`sectionKey` text(32) NOT NULL,
	`stepKey` text(32) NOT NULL,
	`status` text DEFAULT 'locked' NOT NULL,
	`intakeData` text,
	`artifactContent` text,
	`lastFeedback` text,
	`createdAt` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	`updatedAt` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "build_sub_steps_status_check" CHECK("build_sub_steps"."status" in ('locked', 'in_progress', 'intake_complete', 'generating', 'review', 'approved', 'amber'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `build_sub_steps_workspace_step_unique` ON `build_sub_steps` (`workspaceId`,`stepKey`);--> statement-breakpoint
CREATE TABLE `content_engine_config` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspaceId` integer NOT NULL,
	`configData` text NOT NULL,
	`platformFit` text,
	`contentPillars` text,
	`contentTypeMix` text,
	`createdAt` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	`updatedAt` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_engine_config_workspace_unique` ON `content_engine_config` (`workspaceId`);--> statement-breakpoint
CREATE TABLE `create_outputs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspaceId` integer NOT NULL,
	`parentId` integer,
	`platform` text(32) NOT NULL,
	`contentType` text(32) NOT NULL,
	`pillar` text(128),
	`angle` text(64),
	`direction` text,
	`content` text NOT NULL,
	`imageUrl` text,
	`imageFormat` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`createdAt` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	`updatedAt` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "create_outputs_status_check" CHECK("create_outputs"."status" in ('draft', 'approved', 'published', 'archived'))
);
--> statement-breakpoint
CREATE TABLE `file_uploads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspaceId` integer NOT NULL,
	`stepKey` text(32),
	`fileName` text(256) NOT NULL,
	`fileType` text(32) NOT NULL,
	`tokenCount` integer DEFAULT 0,
	`extractedText` text,
	`storageKey` text(256),
	`createdAt` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `visual_identity` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workspaceId` integer NOT NULL,
	`tournamentRound` integer DEFAULT 1 NOT NULL,
	`candidateSets` text,
	`selectedSetIndex` integer,
	`styleDocument` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`createdAt` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	`updatedAt` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	FOREIGN KEY (`workspaceId`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "visual_identity_status_check" CHECK("visual_identity"."status" in ('pending', 'round1', 'round2', 'escape', 'selected', 'approved', 'skipped'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `visual_identity_workspace_unique` ON `visual_identity` (`workspaceId`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text(128) NOT NULL,
	`createdAt` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL,
	`updatedAt` integer DEFAULT (cast((julianday('now') - 2440587.5) * 86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_name_unique` ON `workspaces` (`name`);
--> statement-breakpoint
CREATE TRIGGER `workspaces_updated_at`
AFTER UPDATE ON `workspaces`
FOR EACH ROW
WHEN NEW.`updatedAt` = OLD.`updatedAt`
BEGIN
  UPDATE `workspaces`
  SET `updatedAt` = (cast((julianday('now') - 2440587.5) * 86400000 as integer))
  WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `build_sections_updated_at`
AFTER UPDATE ON `build_sections`
FOR EACH ROW
WHEN NEW.`updatedAt` = OLD.`updatedAt`
BEGIN
  UPDATE `build_sections`
  SET `updatedAt` = (cast((julianday('now') - 2440587.5) * 86400000 as integer))
  WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `build_sub_steps_updated_at`
AFTER UPDATE ON `build_sub_steps`
FOR EACH ROW
WHEN NEW.`updatedAt` = OLD.`updatedAt`
BEGIN
  UPDATE `build_sub_steps`
  SET `updatedAt` = (cast((julianday('now') - 2440587.5) * 86400000 as integer))
  WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `build_artifacts_updated_at`
AFTER UPDATE ON `build_artifacts`
FOR EACH ROW
WHEN NEW.`updatedAt` = OLD.`updatedAt`
BEGIN
  UPDATE `build_artifacts`
  SET `updatedAt` = (cast((julianday('now') - 2440587.5) * 86400000 as integer))
  WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `visual_identity_updated_at`
AFTER UPDATE ON `visual_identity`
FOR EACH ROW
WHEN NEW.`updatedAt` = OLD.`updatedAt`
BEGIN
  UPDATE `visual_identity`
  SET `updatedAt` = (cast((julianday('now') - 2440587.5) * 86400000 as integer))
  WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `create_outputs_updated_at`
AFTER UPDATE ON `create_outputs`
FOR EACH ROW
WHEN NEW.`updatedAt` = OLD.`updatedAt`
BEGIN
  UPDATE `create_outputs`
  SET `updatedAt` = (cast((julianday('now') - 2440587.5) * 86400000 as integer))
  WHERE `id` = NEW.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `content_engine_config_updated_at`
AFTER UPDATE ON `content_engine_config`
FOR EACH ROW
WHEN NEW.`updatedAt` = OLD.`updatedAt`
BEGIN
  UPDATE `content_engine_config`
  SET `updatedAt` = (cast((julianday('now') - 2440587.5) * 86400000 as integer))
  WHERE `id` = NEW.`id`;
END;
