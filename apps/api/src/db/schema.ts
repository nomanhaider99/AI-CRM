import {
  AI_MESSAGE_ROLES,
  CLIENT_EVENT_TYPES,
  CLIENT_STATUSES,
  INVOICE_STATUSES,
  PENDING_ACTION_STATUSES,
  PLANS,
  ROLES,
  USAGE_METRICS,
} from "@crm/shared";
import { sql } from "drizzle-orm";
import {
  bigint,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

export const EMBEDDING_DIMENSIONS = 1536;

// Enums
export const roleEnum = pgEnum("role", ROLES);
export const planEnum = pgEnum("plan", PLANS);
export const clientStatusEnum = pgEnum("client_status", CLIENT_STATUSES);
export const clientEventTypeEnum = pgEnum("client_event_type", CLIENT_EVENT_TYPES);
export const invoiceStatusEnum = pgEnum("invoice_status", INVOICE_STATUSES);
export const pendingActionStatusEnum = pgEnum("pending_action_status", PENDING_ACTION_STATUSES);
export const aiMessageRoleEnum = pgEnum("ai_message_role", AI_MESSAGE_ROLES);
export const usageMetricEnum = pgEnum("usage_metric", USAGE_METRICS);

// Column helpers
const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const money = (name: string) => numeric(name, { precision: 12, scale: 2 });
const workspaceId = () =>
  uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" });

// Global (not tenant scoped)
export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    // Embedded in every JWT; bumping it (logout) revokes all of the user's tokens.
    sessionVersion: integer("session_version").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_unique").on(sql`lower(${t.email})`)],
);

export const workspaces = pgTable("workspaces", {
  id: id(),
  name: text("name").notNull(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  plan: planEnum("plan").notNull().default("free"),
  aiModel: text("ai_model").notNull().default("claude-sonnet-5-5"),
  // Last invoice number issued (INV-0001 is 1). Incremented with UPDATE ... RETURNING, which row-locks
  // the workspace, so concurrent creates get distinct, gapless-at-issue numbers.
  invoiceSeq: integer("invoice_seq").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// Tenant scoped
export const memberships = pgTable(
  "memberships",
  {
    workspaceId: workspaceId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index("memberships_user_idx").on(t.userId)],
);

export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    workspaceId: workspaceId(),
    email: text("email").notNull(),
    role: roleEnum("role").notNull(),
    token: text("token").notNull(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("invitations_token_unique").on(t.token), index("invitations_workspace_idx").on(t.workspaceId)],
);

export const clients = pgTable(
  "clients",
  {
    id: id(),
    workspaceId: workspaceId(),
    name: text("name").notNull(),
    company: text("company"),
    email: text("email"),
    phone: text("phone"),
    notes: text("notes"),
    status: clientStatusEnum("status").notNull().default("lead"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("clients_workspace_idx").on(t.workspaceId), index("clients_workspace_name_idx").on(t.workspaceId, t.name)],
);

export const clientEvents = pgTable(
  "client_events",
  {
    id: id(),
    workspaceId: workspaceId(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    type: clientEventTypeEnum("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    amount: money("amount"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("client_events_client_idx").on(t.workspaceId, t.clientId, t.createdAt)],
);

export const pipelineStages = pgTable(
  "pipeline_stages",
  {
    id: id(),
    workspaceId: workspaceId(),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("pipeline_stages_workspace_position_unique").on(t.workspaceId, t.position)],
);

export const deals = pgTable(
  "deals",
  {
    id: id(),
    workspaceId: workspaceId(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    value: money("value").notNull().default("0"),
    currency: text("currency").notNull().default("USD"),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => pipelineStages.id, { onDelete: "restrict" }),
    position: integer("position").notNull().default(0),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("deals_stage_idx").on(t.workspaceId, t.stageId, t.position),
    index("deals_owner_idx").on(t.workspaceId, t.ownerId),
  ],
);

export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    workspaceId: workspaceId(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    dealId: uuid("deal_id").references(() => deals.id, { onDelete: "set null" }),
    number: text("number").notNull(),
    status: invoiceStatusEnum("status").notNull().default("draft"),
    issueDate: date("issue_date").notNull(),
    dueDate: date("due_date"),
    total: money("total").notNull().default("0"),
    currency: text("currency").notNull().default("USD"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("invoices_workspace_number_unique").on(t.workspaceId, t.number),
    index("invoices_client_idx").on(t.workspaceId, t.clientId),
  ],
);

export const invoiceItems = pgTable(
  "invoice_items",
  {
    id: id(),
    workspaceId: workspaceId(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    qty: numeric("qty", { precision: 12, scale: 2 }).notNull(),
    unitPrice: money("unit_price").notNull(),
    // Line order on the invoice (items are written in one insert, so created_at cannot order them).
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("invoice_items_invoice_idx").on(t.invoiceId, t.position)],
);

export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: id(),
    workspaceId: workspaceId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("ai_conversations_user_idx").on(t.workspaceId, t.userId)],
);

export const aiMessages = pgTable(
  "ai_messages",
  {
    id: id(),
    workspaceId: workspaceId(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    role: aiMessageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    toolCalls: jsonb("tool_calls"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

export const aiPendingActions = pgTable(
  "ai_pending_actions",
  {
    id: id(),
    workspaceId: workspaceId(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tool: text("tool").notNull(),
    args: jsonb("args").notNull(),
    status: pendingActionStatusEnum("status").notNull().default("pending"),
    result: jsonb("result"),
    createdAt: createdAt(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("ai_pending_actions_user_idx").on(t.workspaceId, t.userId, t.status)],
);

export const clientEmbeddings = pgTable(
  "client_embeddings",
  {
    clientId: uuid("client_id")
      .primaryKey()
      .references(() => clients.id, { onDelete: "cascade" }),
    workspaceId: workspaceId(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("client_embeddings_workspace_idx").on(t.workspaceId),
    index("client_embeddings_hnsw_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    workspaceId: workspaceId(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id"),
    meta: jsonb("meta"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_workspace_idx").on(t.workspaceId, t.createdAt)],
);

export const usageCounters = pgTable(
  "usage_counters",
  {
    workspaceId: workspaceId(),
    period: text("period").notNull(), // YYYY-MM
    metric: usageMetricEnum("metric").notNull(),
    value: bigint("value", { mode: "number" }).notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.period, t.metric] })],
);

// Tables that carry workspace_id. Migration 0003 enables and forces RLS on each of these.
export const tenantTables = [
  memberships,
  invitations,
  clients,
  clientEvents,
  pipelineStages,
  deals,
  invoices,
  invoiceItems,
  aiConversations,
  aiMessages,
  aiPendingActions,
  clientEmbeddings,
  auditLog,
  usageCounters,
] as const;
