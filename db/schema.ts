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

export const agentConversations = sqliteTable("agent_conversations", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  activeFamily: text("active_family").notNull().default(""),
  modelRoute: text("model_route").notNull().default("auto"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("agent_conversations_project_updated_idx").on(table.projectId, table.updatedAt),
  index("agent_conversations_owner_idx").on(table.ownerId),
]);

export const agentMessages = sqliteTable("agent_messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => agentConversations.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  role: text("role").notNull(),
  kind: text("kind").notNull().default(""),
  status: text("status").notNull().default("info"),
  title: text("title").notNull().default(""),
  text: text("text").notNull().default(""),
  code: text("code").notNull().default(""),
  metricsJson: text("metrics_json").notNull().default("{}"),
  evidenceLevel: text("evidence_level").notNull().default(""),
  modelId: text("model_id").notNull().default(""),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("agent_messages_conversation_sequence_unique").on(table.conversationId, table.sequence),
  index("agent_messages_project_idx").on(table.projectId),
  index("agent_messages_owner_idx").on(table.ownerId),
]);

export const agentAttachments = sqliteTable("agent_attachments", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull().references(() => agentConversations.id, { onDelete: "cascade" }),
  messageId: text("message_id").references(() => agentMessages.id, { onDelete: "set null" }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  direction: text("direction").notNull(),
  objectKey: text("object_key").notNull(),
  fileName: text("file_name").notNull(),
  mediaType: text("media_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  width: integer("width").notNull().default(0),
  height: integer("height").notNull().default(0),
  sha256: text("sha256").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  index("agent_attachments_conversation_idx").on(table.conversationId),
  index("agent_attachments_message_idx").on(table.messageId),
  index("agent_attachments_project_idx").on(table.projectId),
  uniqueIndex("agent_attachments_object_key_unique").on(table.objectKey),
]);
