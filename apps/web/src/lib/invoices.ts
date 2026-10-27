import type { InvoiceStatus, Role } from "@crm/shared";
import { can } from "@crm/shared";
import { isoDay } from "./format";
import type { Invoice } from "./types";

/** What the badge shows: the stored status, or "overdue" for a sent invoice past its due date. */
export type InvoiceDisplayStatus = InvoiceStatus | "overdue";

export const INVOICE_STATUS_LABELS: Record<InvoiceDisplayStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  paid: "Paid",
  overdue: "Overdue",
};

export function displayStatus(invoice: Pick<Invoice, "status" | "dueDate">, today = isoDay()): InvoiceDisplayStatus {
  return invoice.status === "sent" && invoice.dueDate !== null && invoice.dueDate < today ? "overdue" : invoice.status;
}

/**
 * Mirrors the API rule: managers change any invoice, sellers only those on deals they own; paid
 * invoices are locked for everyone. The API still decides; this only hides actions that would fail.
 */
export function canEditInvoice(role: Role, userId: string, invoice: Pick<Invoice, "status" | "dealOwnerId">): boolean {
  if (invoice.status === "paid") return false;
  return can(role, "invoices:write_any") || invoice.dealOwnerId === userId;
}
