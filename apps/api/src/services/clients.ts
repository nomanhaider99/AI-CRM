import type { CreateClientEventInput, CreateClientInput, ListClientsQuery, PaginationQuery, UpdateClientInput } from "@crm/shared";
import { and, count, desc, eq, ilike, or } from "drizzle-orm";
import type { Tx } from "../db/context";
import { withDbContext } from "../db/context";
import { clientEvents, clients, memberships } from "../db/schema";
import { badRequest, notFound } from "../lib/http-error";
import { audit } from "./audit";
import type { TenantRef } from "./workspaces";

const clientFields = {
  id: clients.id,
  name: clients.name,
  company: clients.company,
  email: clients.email,
  phone: clients.phone,
  notes: clients.notes,
  status: clients.status,
  ownerId: clients.ownerId,
  createdAt: clients.createdAt,
  updatedAt: clients.updatedAt,
};

const eventFields = {
  id: clientEvents.id,
  clientId: clientEvents.clientId,
  type: clientEvents.type,
  title: clientEvents.title,
  body: clientEvents.body,
  amount: clientEvents.amount,
  createdBy: clientEvents.createdBy,
  createdAt: clientEvents.createdAt,
};

// numeric(12,2) comes back from Postgres as a string; the API speaks numbers, like the input schema.
const toEvent = <E extends { amount: string | null }>(e: E) => ({ ...e, amount: e.amount === null ? null : Number(e.amount) });

// Escape LIKE wildcards so a search for "50%" matches literally.
const likePattern = (search: string) => `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

// Owners must belong to the workspace. memberships is under RLS, so another tenant's user is invisible here.
async function assertMember(tx: Tx, ctx: TenantRef, userId: string) {
  const [member] = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, ctx.workspaceId), eq(memberships.userId, userId)));
  if (!member) throw badRequest("Owner must be a member of this workspace");
}

// Foreign keys bypass RLS, so a client id from another workspace must be rejected explicitly.
async function assertClient(tx: Tx, ctx: TenantRef, clientId: string) {
  const [client] = await tx
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.workspaceId, ctx.workspaceId), eq(clients.id, clientId)));
  if (!client) throw notFound("Client not found");
}

export function listClients(ctx: TenantRef, query: ListClientsQuery) {
  return withDbContext(ctx, async (tx) => {
    const pattern = query.search ? likePattern(query.search) : undefined;
    const where = and(
      eq(clients.workspaceId, ctx.workspaceId),
      query.status ? eq(clients.status, query.status) : undefined,
      pattern ? or(ilike(clients.name, pattern), ilike(clients.company, pattern), ilike(clients.email, pattern)) : undefined,
    );
    const rows = await tx
      .select(clientFields)
      .from(clients)
      .where(where)
      .orderBy(desc(clients.createdAt), desc(clients.id))
      .limit(query.limit)
      .offset(query.offset);
    const [total] = await tx.select({ value: count() }).from(clients).where(where);
    return { clients: rows, total: total?.value ?? 0, limit: query.limit, offset: query.offset };
  });
}

export function getClient(ctx: TenantRef, clientId: string) {
  return withDbContext(ctx, async (tx) => {
    const [client] = await tx
      .select(clientFields)
      .from(clients)
      .where(and(eq(clients.workspaceId, ctx.workspaceId), eq(clients.id, clientId)));
    if (!client) throw notFound("Client not found");
    return client;
  });
}

export function createClient(ctx: TenantRef, input: CreateClientInput) {
  return withDbContext(ctx, async (tx) => {
    // The creator owns the client unless another member is named.
    const ownerId = input.ownerId ?? ctx.userId;
    if (input.ownerId) await assertMember(tx, ctx, input.ownerId);

    const [client] = await tx
      .insert(clients)
      .values({ ...input, ownerId, workspaceId: ctx.workspaceId })
      .returning(clientFields);
    await audit(tx, { ...ctx, action: "client.create", entity: "client", entityId: client!.id, meta: { name: client!.name } });
    return client!;
  });
}

export function updateClient(ctx: TenantRef, clientId: string, input: UpdateClientInput) {
  return withDbContext(ctx, async (tx) => {
    await assertClient(tx, ctx, clientId);
    if (input.ownerId) await assertMember(tx, ctx, input.ownerId);

    const [client] = await tx
      .update(clients)
      .set(input)
      .where(and(eq(clients.workspaceId, ctx.workspaceId), eq(clients.id, clientId)))
      .returning(clientFields);
    await audit(tx, { ...ctx, action: "client.update", entity: "client", entityId: clientId, meta: { fields: Object.keys(input) } });
    return client!;
  });
}

export function deleteClient(ctx: TenantRef, clientId: string) {
  return withDbContext(ctx, async (tx) => {
    // Events and deals cascade; invoices restrict, so a client with invoices answers 409.
    const deleted = await tx
      .delete(clients)
      .where(and(eq(clients.workspaceId, ctx.workspaceId), eq(clients.id, clientId)))
      .returning({ name: clients.name });
    if (deleted.length === 0) throw notFound("Client not found");
    await audit(tx, { ...ctx, action: "client.delete", entity: "client", entityId: clientId, meta: { name: deleted[0]!.name } });
  });
}

export function listClientEvents(ctx: TenantRef, clientId: string, page: PaginationQuery) {
  return withDbContext(ctx, async (tx) => {
    await assertClient(tx, ctx, clientId);
    const where = and(eq(clientEvents.workspaceId, ctx.workspaceId), eq(clientEvents.clientId, clientId));
    const rows = await tx
      .select(eventFields)
      .from(clientEvents)
      .where(where)
      .orderBy(desc(clientEvents.createdAt), desc(clientEvents.id))
      .limit(page.limit)
      .offset(page.offset);
    const [total] = await tx.select({ value: count() }).from(clientEvents).where(where);
    return { events: rows.map(toEvent), total: total?.value ?? 0, limit: page.limit, offset: page.offset };
  });
}

export function createClientEvent(ctx: TenantRef, clientId: string, input: CreateClientEventInput) {
  return withDbContext(ctx, async (tx) => {
    await assertClient(tx, ctx, clientId);
    const [event] = await tx
      .insert(clientEvents)
      .values({
        workspaceId: ctx.workspaceId,
        clientId,
        type: input.type,
        title: input.title,
        body: input.body,
        amount: input.amount === undefined ? null : input.amount.toFixed(2),
        createdBy: ctx.userId,
      })
      .returning(eventFields);
    await audit(tx, {
      ...ctx,
      action: "client_event.create",
      entity: "client_event",
      entityId: event!.id,
      meta: { clientId, type: input.type, ...(input.amount === undefined ? {} : { amount: input.amount }) },
    });
    return toEvent(event!);
  });
}
