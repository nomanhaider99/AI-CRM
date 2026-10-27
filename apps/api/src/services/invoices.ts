import type { CreateInvoiceInput, InvoiceItemInput, InvoiceStatus, ListInvoicesQuery, UpdateInvoiceInput } from "@crm/shared";
import { can, centsToDecimal, formatInvoiceNumber, invoiceTotals, lineTotalCents } from "@crm/shared";
import { and, asc, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { Tx } from "../db/context";
import { withDbContext } from "../db/context";
import { clientEvents, clients, deals, invoiceItems, invoices, workspaces } from "../db/schema";
import { badRequest, conflict, forbidden, notFound } from "../lib/http-error";
import { audit } from "./audit";
import type { DealActor } from "./deals";

/** Invoice rules depend on the caller's role (sellers: invoices on their own deals), like deals. */
export type InvoiceActor = DealActor;

const invoiceFields = {
  id: invoices.id,
  number: invoices.number,
  status: invoices.status,
  clientId: invoices.clientId,
  clientName: clients.name,
  clientCompany: clients.company,
  clientEmail: clients.email,
  dealId: invoices.dealId,
  dealTitle: deals.title,
  dealOwnerId: deals.ownerId,
  issueDate: invoices.issueDate,
  dueDate: invoices.dueDate,
  total: invoices.total,
  currency: invoices.currency,
  paidAt: invoices.paidAt,
  createdBy: invoices.createdBy,
  createdAt: invoices.createdAt,
  updatedAt: invoices.updatedAt,
};

const seesOwnOnly = (ctx: InvoiceActor) => !can(ctx.role, "deals:read_any");

// numeric(12,2) comes back as a string; the API speaks numbers. A seller does not see the title of
// another member's deal (deals answer 404 for them), only that the invoice is tied to one.
function toInvoice(ctx: InvoiceActor, row: InvoiceRow) {
  const hidden = seesOwnOnly(ctx) && row.dealOwnerId !== null && row.dealOwnerId !== ctx.userId;
  return { ...row, total: Number(row.total), dealTitle: hidden ? null : row.dealTitle };
}

type InvoiceRow = Awaited<ReturnType<typeof findInvoice>>;

// Escape LIKE wildcards so a search for "50%" matches literally.
const likePattern = (search: string) => `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

async function findInvoice(tx: Tx, ctx: InvoiceActor, invoiceId: string, lock = false) {
  const query = tx
    .select(invoiceFields)
    .from(invoices)
    .innerJoin(clients, eq(clients.id, invoices.clientId))
    .leftJoin(deals, eq(deals.id, invoices.dealId))
    .where(and(eq(invoices.workspaceId, ctx.workspaceId), eq(invoices.id, invoiceId)));
  // Writers lock the invoice row so concurrent edits (or two "mark paid" clicks) apply one at a time.
  const [invoice] = lock ? await query.for("update", { of: invoices }) : await query;
  if (!invoice) throw notFound("Invoice not found");
  return invoice;
}

async function itemsOf(tx: Tx, ctx: InvoiceActor, invoiceId: string) {
  const rows = await tx
    .select({ id: invoiceItems.id, description: invoiceItems.description, qty: invoiceItems.qty, unitPrice: invoiceItems.unitPrice })
    .from(invoiceItems)
    .where(and(eq(invoiceItems.workspaceId, ctx.workspaceId), eq(invoiceItems.invoiceId, invoiceId)))
    .orderBy(asc(invoiceItems.position), asc(invoiceItems.id));
  return rows.map((r) => {
    const line = { qty: Number(r.qty), unitPrice: Number(r.unitPrice) };
    return { id: r.id, description: r.description, ...line, amount: Number(centsToDecimal(lineTotalCents(line))) };
  });
}

async function invoiceWithItems(tx: Tx, ctx: InvoiceActor, invoiceId: string) {
  const invoice = toInvoice(ctx, await findInvoice(tx, ctx, invoiceId));
  return { ...invoice, items: await itemsOf(tx, ctx, invoiceId) };
}

// Managers change any invoice; sellers only those tied to a deal they own.
function assertCanWrite(ctx: InvoiceActor, invoice: { dealOwnerId: string | null }) {
  if (!can(ctx.role, "invoices:write_any") && invoice.dealOwnerId !== ctx.userId) {
    throw forbidden("You can only change invoices on your own deals");
  }
}

// Foreign keys bypass RLS, so ids sent in the body must be checked against the workspace.
async function assertClientRef(tx: Tx, ctx: InvoiceActor, clientId: string) {
  const [client] = await tx
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.workspaceId, ctx.workspaceId), eq(clients.id, clientId)));
  if (!client) throw badRequest("Client not found in this workspace");
}

/** The deal must be in this workspace, belong to the invoice's client and, for sellers, be their own. */
async function assertDealRef(tx: Tx, ctx: InvoiceActor, dealId: string | null, clientId: string) {
  if (dealId === null) {
    if (!can(ctx.role, "invoices:write_any")) throw forbidden("Sellers can only invoice their own deals; choose one of your deals");
    return;
  }
  const [deal] = await tx
    .select({ clientId: deals.clientId, ownerId: deals.ownerId })
    .from(deals)
    .where(and(eq(deals.workspaceId, ctx.workspaceId), eq(deals.id, dealId)));
  // Another seller's deal is invisible to a seller, as in the deals API.
  if (!deal || (seesOwnOnly(ctx) && deal.ownerId !== null && deal.ownerId !== ctx.userId)) {
    throw badRequest("Deal not found in this workspace");
  }
  if (deal.clientId !== clientId) throw badRequest("The deal belongs to a different client");
  if (!can(ctx.role, "invoices:write_any") && deal.ownerId !== ctx.userId) throw forbidden("You can only invoice your own deals");
}

/**
 * Next number for the workspace. The UPDATE takes the workspace row lock until commit, so concurrent
 * creates queue here and each gets the next value; the unique index on (workspace_id, number) backs it up.
 */
async function nextInvoiceNumber(tx: Tx, ctx: InvoiceActor) {
  const [row] = await tx
    .update(workspaces)
    .set({ invoiceSeq: sql`${workspaces.invoiceSeq} + 1` })
    .where(eq(workspaces.id, ctx.workspaceId))
    .returning({ seq: workspaces.invoiceSeq });
  if (!row) throw notFound("Workspace not found");
  return formatInvoiceNumber(row.seq);
}

/** Replaces the line items and returns the total computed from them (never trusted from the client). */
async function writeItems(tx: Tx, ctx: InvoiceActor, invoiceId: string, items: InvoiceItemInput[], replace: boolean) {
  if (replace) {
    await tx.delete(invoiceItems).where(and(eq(invoiceItems.workspaceId, ctx.workspaceId), eq(invoiceItems.invoiceId, invoiceId)));
  }
  await tx.insert(invoiceItems).values(
    items.map((item, position) => ({
      workspaceId: ctx.workspaceId,
      invoiceId,
      description: item.description,
      qty: item.qty.toFixed(2),
      unitPrice: item.unitPrice.toFixed(2),
      position,
    })),
  );
  return invoiceTotals(items);
}

/** Adds an "invoice" entry to the client's history timeline. */
async function timelineEvent(tx: Tx, ctx: InvoiceActor, invoice: { clientId: string; number: string; total: string; currency: string }, verb: string, body?: string) {
  await tx.insert(clientEvents).values({
    workspaceId: ctx.workspaceId,
    clientId: invoice.clientId,
    type: "invoice",
    title: `Invoice ${invoice.number} ${verb}`,
    body: body ?? null,
    amount: invoice.total,
    createdBy: ctx.userId,
  });
}

export function listInvoices(ctx: InvoiceActor, query: ListInvoicesQuery) {
  return withDbContext(ctx, async (tx) => {
    const pattern = query.search ? likePattern(query.search) : undefined;
    const where = and(
      eq(invoices.workspaceId, ctx.workspaceId),
      query.status ? eq(invoices.status, query.status) : undefined,
      query.clientId ? eq(invoices.clientId, query.clientId) : undefined,
      pattern ? or(ilike(invoices.number, pattern), ilike(clients.name, pattern), ilike(clients.company, pattern)) : undefined,
    );
    const rows = await tx
      .select(invoiceFields)
      .from(invoices)
      .innerJoin(clients, eq(clients.id, invoices.clientId))
      .leftJoin(deals, eq(deals.id, invoices.dealId))
      .where(where)
      .orderBy(desc(invoices.createdAt), desc(invoices.id))
      .limit(query.limit)
      .offset(query.offset);
    const [total] = await tx
      .select({ value: count() })
      .from(invoices)
      .innerJoin(clients, eq(clients.id, invoices.clientId))
      .where(where);
    return { invoices: rows.map((r) => toInvoice(ctx, r)), total: total?.value ?? 0, limit: query.limit, offset: query.offset };
  });
}

export function getInvoice(ctx: InvoiceActor, invoiceId: string) {
  return withDbContext(ctx, (tx) => invoiceWithItems(tx, ctx, invoiceId));
}

export function createInvoice(ctx: InvoiceActor, input: CreateInvoiceInput) {
  return withDbContext(ctx, async (tx) => {
    await assertClientRef(tx, ctx, input.clientId);
    await assertDealRef(tx, ctx, input.dealId ?? null, input.clientId);

    const number = await nextInvoiceNumber(tx, ctx);
    const [created] = await tx
      .insert(invoices)
      .values({
        workspaceId: ctx.workspaceId,
        clientId: input.clientId,
        dealId: input.dealId ?? null,
        number,
        status: input.status,
        issueDate: input.issueDate,
        dueDate: input.dueDate ?? null,
        currency: input.currency,
        createdBy: ctx.userId,
      })
      .returning({ id: invoices.id });
    const invoiceId = created!.id;
    const { totalCents } = await writeItems(tx, ctx, invoiceId, input.items, false);
    const total = centsToDecimal(totalCents);
    await tx.update(invoices).set({ total }).where(and(eq(invoices.workspaceId, ctx.workspaceId), eq(invoices.id, invoiceId)));

    const lines = `${input.items.length} ${input.items.length === 1 ? "item" : "items"}`;
    await timelineEvent(tx, ctx, { clientId: input.clientId, number, total, currency: input.currency }, "created", lines);
    await audit(tx, {
      ...ctx,
      action: "invoice.create",
      entity: "invoice",
      entityId: invoiceId,
      meta: { number, clientId: input.clientId, dealId: input.dealId ?? null, total: Number(total), currency: input.currency, items: input.items.length },
    });
    return invoiceWithItems(tx, ctx, invoiceId);
  });
}

/** Sets status paid, stamps paid_at and adds the timeline event. The caller holds the invoice lock. */
async function applyPaid(tx: Tx, ctx: InvoiceActor, invoice: InvoiceRow) {
  await tx
    .update(invoices)
    .set({ status: "paid", paidAt: new Date() })
    .where(and(eq(invoices.workspaceId, ctx.workspaceId), eq(invoices.id, invoice.id)));
  await timelineEvent(tx, ctx, invoice, "paid");
  await audit(tx, {
    ...ctx,
    action: "invoice.pay",
    entity: "invoice",
    entityId: invoice.id,
    meta: { number: invoice.number, total: Number(invoice.total), currency: invoice.currency, fromStatus: invoice.status },
  });
}

// Paid is final: the amount went into the client's history, so the invoice is no longer editable.
const assertNotPaid = (invoice: { status: InvoiceStatus }) => {
  if (invoice.status === "paid") throw conflict("This invoice is paid and can no longer be changed");
};

export function updateInvoice(ctx: InvoiceActor, invoiceId: string, input: UpdateInvoiceInput) {
  return withDbContext(ctx, async (tx) => {
    const invoice = await findInvoice(tx, ctx, invoiceId, true);
    assertCanWrite(ctx, invoice);
    assertNotPaid(invoice);
    if (input.dealId !== undefined && input.dealId !== invoice.dealId) await assertDealRef(tx, ctx, input.dealId, invoice.clientId);

    // Each date is checked against the other's stored value when only one is sent.
    const issueDate = input.issueDate ?? invoice.issueDate;
    const dueDate = input.dueDate === undefined ? invoice.dueDate : input.dueDate;
    if (dueDate && dueDate < issueDate) {
      throw badRequest("Invalid request", { formErrors: [], fieldErrors: { dueDate: ["Due date must be on or after issue date"] } });
    }

    const { items, status, ...fields } = input;
    let total: string | undefined;
    if (items) total = centsToDecimal((await writeItems(tx, ctx, invoiceId, items, true)).totalCents);
    const changes = { ...fields, ...(total === undefined ? {} : { total }), ...(status && status !== "paid" ? { status } : {}) };
    if (Object.keys(changes).length > 0) {
      await tx.update(invoices).set(changes).where(and(eq(invoices.workspaceId, ctx.workspaceId), eq(invoices.id, invoiceId)));
    }
    await audit(tx, {
      ...ctx,
      action: "invoice.update",
      entity: "invoice",
      entityId: invoiceId,
      meta: {
        number: invoice.number,
        fields: Object.keys(input),
        ...(total === undefined ? {} : { fromTotal: Number(invoice.total), toTotal: Number(total) }),
        ...(status && status !== invoice.status ? { fromStatus: invoice.status, toStatus: status } : {}),
      },
    });
    // A status PATCH to paid goes through the same path as POST /pay.
    if (status === "paid") await applyPaid(tx, ctx, await findInvoice(tx, ctx, invoiceId));
    return invoiceWithItems(tx, ctx, invoiceId);
  });
}

export function markInvoicePaid(ctx: InvoiceActor, invoiceId: string) {
  return withDbContext(ctx, async (tx) => {
    const invoice = await findInvoice(tx, ctx, invoiceId, true);
    assertCanWrite(ctx, invoice);
    if (invoice.status === "paid") throw conflict("This invoice is already paid");
    await applyPaid(tx, ctx, invoice);
    return invoiceWithItems(tx, ctx, invoiceId);
  });
}

export function deleteInvoice(ctx: InvoiceActor, invoiceId: string) {
  return withDbContext(ctx, async (tx) => {
    const invoice = await findInvoice(tx, ctx, invoiceId, true);
    // Items cascade. Timeline entries stay: they record what happened.
    await tx.delete(invoices).where(and(eq(invoices.workspaceId, ctx.workspaceId), eq(invoices.id, invoiceId)));
    await audit(tx, {
      ...ctx,
      action: "invoice.delete",
      entity: "invoice",
      entityId: invoiceId,
      meta: { number: invoice.number, clientId: invoice.clientId, status: invoice.status, total: Number(invoice.total), currency: invoice.currency },
    });
  });
}
