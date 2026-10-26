import { z } from "zod";
import { currencySchema, emailSchema, idSchema, isoDateSchema, moneySchema, paginationQuerySchema } from "./common";
import { clientEventTypeSchema, clientStatusSchema, invoiceStatusSchema, roleSchema } from "./enums";

const name = z.string().trim().min(1).max(200);
const optionalText = (max: number) => z.string().trim().max(max).optional();

// Auth
export const signupSchema = z.object({
  name,
  email: emailSchema,
  password: z.string().min(8).max(128),
});
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

// Workspaces, members, invitations
export const createWorkspaceSchema = z.object({ name });
export const updateWorkspaceSchema = z.object({ name, aiModel: z.string().trim().min(1).max(100) }).partial();
export const createInvitationSchema = z.object({ email: emailSchema, role: roleSchema });
export const updateMemberSchema = z.object({ role: roleSchema });
// Invitation tokens are 32 random bytes, base64url encoded.
export const invitationTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Invalid invitation token");

// Clients and timeline
export const createClientSchema = z.object({
  name,
  company: optionalText(200),
  email: emailSchema.optional(),
  phone: optionalText(50),
  notes: optionalText(10_000),
  status: clientStatusSchema.default("lead"),
  ownerId: idSchema.optional(),
});
// No defaults here (a PATCH must not reset unsent fields); null clears an optional field.
export const updateClientSchema = z
  .object({
    name,
    company: optionalText(200).nullable(),
    email: emailSchema.nullable(),
    phone: optionalText(50).nullable(),
    notes: optionalText(10_000).nullable(),
    status: clientStatusSchema,
    ownerId: idSchema.nullable(),
  })
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Provide at least one field to update" });
export const listClientsQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  status: clientStatusSchema.optional(),
});

export const createClientEventSchema = z.object({
  type: clientEventTypeSchema,
  title: name,
  body: optionalText(20_000),
  amount: moneySchema.optional(),
});

// Deals (Kanban). ownerId: omitted = the creator, null = unassigned.
export const createDealSchema = z.object({
  clientId: idSchema,
  title: name,
  value: moneySchema.default(0),
  currency: currencySchema.default("USD"),
  stageId: idSchema,
  ownerId: idSchema.nullable().optional(),
});
// Field edits only; stage and position change through moveDealSchema so columns stay ordered.
export const updateDealSchema = z
  .object({
    clientId: idSchema,
    title: name,
    value: moneySchema,
    currency: currencySchema,
    ownerId: idSchema.nullable(),
  })
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Provide at least one field to update" });
// position is the 0-based index in the target column; past the end means last.
export const moveDealSchema = z.object({
  stageId: idSchema,
  position: z.number().int().min(0).max(100_000),
});
export const listDealsQuerySchema = z.object({
  stageId: idSchema.optional(),
  ownerId: idSchema.optional(),
  clientId: idSchema.optional(),
});

// Invoices
export const invoiceItemSchema = z.object({
  description: z.string().trim().min(1).max(500),
  qty: z.number().positive().max(1_000_000),
  unitPrice: moneySchema,
});
export const createInvoiceSchema = z
  .object({
    clientId: idSchema,
    dealId: idSchema.optional(),
    currency: currencySchema.default("USD"),
    issueDate: isoDateSchema,
    dueDate: isoDateSchema.optional(),
    items: z.array(invoiceItemSchema).min(1).max(200),
  })
  .refine((v) => !v.dueDate || v.dueDate >= v.issueDate, {
    message: "Due date must be on or after issue date",
    path: ["dueDate"],
  });
export const updateInvoiceSchema = z
  .object({
    status: invoiceStatusSchema,
    dueDate: isoDateSchema.nullable(),
    items: z.array(invoiceItemSchema).min(1).max(200),
  })
  .partial();

// AI
export const aiChatSchema = z.object({
  conversationId: idSchema.optional(),
  message: z.string().trim().min(1).max(4_000),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;
export type CreateClientEventInput = z.infer<typeof createClientEventSchema>;
export type CreateDealInput = z.infer<typeof createDealSchema>;
export type UpdateDealInput = z.infer<typeof updateDealSchema>;
export type MoveDealInput = z.infer<typeof moveDealSchema>;
export type ListDealsQuery = z.infer<typeof listDealsQuerySchema>;
export type InvoiceItemInput = z.infer<typeof invoiceItemSchema>;
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;
export type AiChatInput = z.infer<typeof aiChatSchema>;
