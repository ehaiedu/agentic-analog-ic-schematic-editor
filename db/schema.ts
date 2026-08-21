import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull(),
  normalizedUsername: text("normalized_username").notNull(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  passwordIterations: integer("password_iterations").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("users_normalized_username_unique").on(table.normalizedUsername),
]);

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (table) => [
  index("sessions_user_id_idx").on(table.userId),
  index("sessions_expires_at_idx").on(table.expiresAt),
]);

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  documentJson: text("document_json").notNull(),
  revision: integer("revision").notNull().default(1),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("projects_owner_updated_idx").on(table.ownerId, table.updatedAt),
]);

export const projectRecovery = sqliteTable("project_recovery", {
  projectId: text("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  documentJson: text("document_json").notNull(),
  baseStorageRevision: integer("base_storage_revision").notNull(),
  designRevision: integer("design_revision").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  index("project_recovery_owner_idx").on(table.ownerId),
]);
