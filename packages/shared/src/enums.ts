import { z } from "zod";

// Single source of truth for enum values. The DB schema imports these too.
export const ROLES = ["admin", "pm", "seller"] as const;
export const PLANS = ["free", "premium"] as const;
export const CLIENT_STATUSES = ["lead", "active", "inactive"] as const;
export const CLIENT_EVENT_TYPES = ["sale", "note", "call", "message", "invoice"] as const;
export const INVOICE_STATUSES = ["draft", "sent", "paid"] as const;
export const PENDING_ACTION_STATUSES = ["pending", "confirmed", "rejected", "executed"] as const;
export const AI_MESSAGE_ROLES = ["user", "assistant", "tool"] as const;
export const USAGE_METRICS = ["ai_messages", "invoices", "storage_bytes"] as const;
export const DEFAULT_PIPELINE_STAGES = ["Lead", "Contacted", "Proposal", "Won", "Lost"] as const;

export const roleSchema = z.enum(ROLES);
export const planSchema = z.enum(PLANS);
export const clientStatusSchema = z.enum(CLIENT_STATUSES);
export const clientEventTypeSchema = z.enum(CLIENT_EVENT_TYPES);
export const invoiceStatusSchema = z.enum(INVOICE_STATUSES);
export const pendingActionStatusSchema = z.enum(PENDING_ACTION_STATUSES);
export const aiMessageRoleSchema = z.enum(AI_MESSAGE_ROLES);
export const usageMetricSchema = z.enum(USAGE_METRICS);

export type Role = z.infer<typeof roleSchema>;
export type Plan = z.infer<typeof planSchema>;
export type ClientStatus = z.infer<typeof clientStatusSchema>;
export type ClientEventType = z.infer<typeof clientEventTypeSchema>;
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;
export type PendingActionStatus = z.infer<typeof pendingActionStatusSchema>;
export type AiMessageRole = z.infer<typeof aiMessageRoleSchema>;
export type UsageMetric = z.infer<typeof usageMetricSchema>;
