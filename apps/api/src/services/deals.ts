import type { CreateDealInput, ListDealsQuery, MoveDealInput, Role, UpdateDealInput } from "@crm/shared";
import { can } from "@crm/shared";
import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { Tx } from "../db/context";
import { withDbContext } from "../db/context";
import { clients, deals, pipelineStages } from "../db/schema";
import { badRequest, conflict, forbidden, notFound } from "../lib/http-error";
import { audit } from "./audit";
import { assertMember } from "./clients";
import type { TenantRef } from "./workspaces";

/** Deal rules depend on the caller's role (sellers: own + unassigned), so services need it too. */
export interface DealActor extends TenantRef {
  role: Role;
}

const dealFields = {
  id: deals.id,
  clientId: deals.clientId,
  clientName: clients.name,
  title: deals.title,
  value: deals.value,
  currency: deals.currency,
  stageId: deals.stageId,
  position: deals.position,
  ownerId: deals.ownerId,
  createdAt: deals.createdAt,
  updatedAt: deals.updatedAt,
};

// numeric(12,2) comes back from Postgres as a string; the API speaks numbers, like the input schema.
const toDeal = <D extends { value: string }>(d: D) => ({ ...d, value: Number(d.value) });

const seesOwnOnly = (ctx: DealActor) => !can(ctx.role, "deals:read_any");
const isVisible = (ctx: DealActor, ownerId: string | null) => !seesOwnOnly(ctx) || ownerId === null || ownerId === ctx.userId;

// Sellers see their own deals and unassigned ones; other sellers' deals answer 404 for them.
const visibleTo = (ctx: DealActor) => (seesOwnOnly(ctx) ? or(eq(deals.ownerId, ctx.userId), isNull(deals.ownerId)) : undefined);

async function findDeal(tx: Tx, ctx: DealActor, dealId: string) {
  const [deal] = await tx
    .select(dealFields)
    .from(deals)
    .innerJoin(clients, eq(clients.id, deals.clientId))
    .where(and(eq(deals.workspaceId, ctx.workspaceId), eq(deals.id, dealId), visibleTo(ctx)));
  if (!deal) throw notFound("Deal not found");
  return deal;
}

// Sellers change only deals they own; an unassigned deal is visible to them but not theirs.
function assertCanWrite(ctx: DealActor, deal: { ownerId: string | null }) {
  if (!can(ctx.role, "deals:write_any") && deal.ownerId !== ctx.userId) throw forbidden("You can only change your own deals");
}

// Any owner other than the current one (the creator, on create) is a reassignment.
async function assertOwnerChange(tx: Tx, ctx: DealActor, current: string | null, next: string | null) {
  if (next === current) return;
  if (!can(ctx.role, "deals:reassign")) throw forbidden("Your role cannot reassign deals");
  if (next) await assertMember(tx, ctx, next);
}

// Foreign keys bypass RLS, so ids sent in the body must be checked against the workspace.
async function assertClientRef(tx: Tx, ctx: DealActor, clientId: string) {
  const [client] = await tx
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.workspaceId, ctx.workspaceId), eq(clients.id, clientId)));
  if (!client) throw badRequest("Client not found in this workspace");
}

/**
 * Locks the stage rows of the columns about to be reordered, in id order so two moves cannot deadlock.
 * Every write that changes positions holds these locks, so each column is renumbered by one writer at a time.
 */
async function lockStages(tx: Tx, ctx: DealActor, stageIds: string[]) {
  const rows = await tx
    .select({ id: pipelineStages.id })
    .from(pipelineStages)
    .where(and(eq(pipelineStages.workspaceId, ctx.workspaceId), inArray(pipelineStages.id, stageIds)))
    .orderBy(asc(pipelineStages.id))
    .for("update");
  return new Set(rows.map((r) => r.id));
}

/** A column's deals in board order, without the deal being moved or deleted. */
function columnOf(tx: Tx, ctx: DealActor, stageId: string, excludeId: string) {
  return tx
    .select({ id: deals.id, ownerId: deals.ownerId })
    .from(deals)
    .where(and(eq(deals.workspaceId, ctx.workspaceId), eq(deals.stageId, stageId), ne(deals.id, excludeId)))
    .orderBy(asc(deals.position), asc(deals.createdAt), asc(deals.id));
}

/** Rewrites positions as 0..n-1 in the given order, which also closes any gaps. */
async function renumber(tx: Tx, ctx: DealActor, ids: string[]) {
  if (ids.length === 0) return;
  const values = sql.join(ids.map((id, i) => sql`(${id}::uuid, ${i}::int)`), sql`, `);
  await tx.execute(sql`update deals d set position = v.pos from (values ${values}) as v(id, pos)
    where d.id = v.id and d.workspace_id = ${ctx.workspaceId} and d.position <> v.pos`);
}

/**
 * Managers see whole columns, so position indexes the column. Sellers see a filtered column (own +
 * unassigned), so position indexes that: the deal lands before the visible card it was dropped on,
 * or at the end of the column when dropped past the last visible card.
 */
function insertIndex(ctx: DealActor, column: { ownerId: string | null }[], position: number) {
  if (!seesOwnOnly(ctx)) return Math.min(position, column.length);
  const visible = column.flatMap((d, i) => (isVisible(ctx, d.ownerId) ? [i] : []));
  return position < visible.length ? visible[position]! : column.length;
}

export function listStages(ctx: DealActor) {
  return withDbContext(ctx, (tx) =>
    tx
      .select({ id: pipelineStages.id, name: pipelineStages.name, position: pipelineStages.position })
      .from(pipelineStages)
      .where(eq(pipelineStages.workspaceId, ctx.workspaceId))
      .orderBy(asc(pipelineStages.position)),
  );
}

export function listDeals(ctx: DealActor, query: ListDealsQuery) {
  return withDbContext(ctx, async (tx) => {
    const rows = await tx
      .select(dealFields)
      .from(deals)
      .innerJoin(clients, eq(clients.id, deals.clientId))
      .innerJoin(pipelineStages, eq(pipelineStages.id, deals.stageId))
      .where(
        and(
          eq(deals.workspaceId, ctx.workspaceId),
          visibleTo(ctx),
          query.stageId ? eq(deals.stageId, query.stageId) : undefined,
          query.ownerId ? eq(deals.ownerId, query.ownerId) : undefined,
          query.clientId ? eq(deals.clientId, query.clientId) : undefined,
        ),
      )
      .orderBy(asc(pipelineStages.position), asc(deals.position), asc(deals.createdAt), asc(deals.id));
    return { deals: rows.map(toDeal) };
  });
}

export function getDeal(ctx: DealActor, dealId: string) {
  return withDbContext(ctx, async (tx) => toDeal(await findDeal(tx, ctx, dealId)));
}

export function createDeal(ctx: DealActor, input: CreateDealInput) {
  return withDbContext(ctx, async (tx) => {
    // The creator owns the deal unless a manager names another member or null (unassigned).
    const ownerId = input.ownerId === undefined ? ctx.userId : input.ownerId;
    await assertOwnerChange(tx, ctx, ctx.userId, ownerId);
    await assertClientRef(tx, ctx, input.clientId);
    const locked = await lockStages(tx, ctx, [input.stageId]);
    if (!locked.has(input.stageId)) throw badRequest("Stage not found in this workspace");

    // New cards go to the bottom of their column.
    const [last] = await tx
      .select({ next: sql<number>`coalesce(max(${deals.position}) + 1, 0)::int` })
      .from(deals)
      .where(and(eq(deals.workspaceId, ctx.workspaceId), eq(deals.stageId, input.stageId)));
    const [created] = await tx
      .insert(deals)
      .values({
        workspaceId: ctx.workspaceId,
        clientId: input.clientId,
        title: input.title,
        value: input.value.toFixed(2),
        currency: input.currency,
        stageId: input.stageId,
        position: last?.next ?? 0,
        ownerId,
      })
      .returning({ id: deals.id });
    await audit(tx, {
      ...ctx,
      action: "deal.create",
      entity: "deal",
      entityId: created!.id,
      meta: { title: input.title, clientId: input.clientId, stageId: input.stageId, ownerId, value: input.value },
    });
    return toDeal(await findDeal(tx, ctx, created!.id));
  });
}

export function updateDeal(ctx: DealActor, dealId: string, input: UpdateDealInput) {
  return withDbContext(ctx, async (tx) => {
    const deal = await findDeal(tx, ctx, dealId);
    assertCanWrite(ctx, deal);
    if (input.ownerId !== undefined) await assertOwnerChange(tx, ctx, deal.ownerId, input.ownerId);
    if (input.clientId) await assertClientRef(tx, ctx, input.clientId);

    const { value, ...rest } = input;
    await tx
      .update(deals)
      .set({ ...rest, ...(value === undefined ? {} : { value: value.toFixed(2) }) })
      .where(and(eq(deals.workspaceId, ctx.workspaceId), eq(deals.id, dealId)));
    const reassigned = input.ownerId !== undefined && input.ownerId !== deal.ownerId;
    await audit(tx, {
      ...ctx,
      action: "deal.update",
      entity: "deal",
      entityId: dealId,
      meta: { fields: Object.keys(input), ...(reassigned ? { fromOwnerId: deal.ownerId, toOwnerId: input.ownerId } : {}) },
    });
    return toDeal(await findDeal(tx, ctx, dealId));
  });
}

export function moveDeal(ctx: DealActor, dealId: string, input: MoveDealInput) {
  return withDbContext(ctx, async (tx) => {
    const before = await findDeal(tx, ctx, dealId);
    assertCanWrite(ctx, before);
    const locked = await lockStages(tx, ctx, [before.stageId, input.stageId]);
    if (!locked.has(input.stageId)) throw badRequest("Stage not found in this workspace");

    // Re-read under the locks: another request may have moved or reassigned the deal meanwhile.
    const deal = await findDeal(tx, ctx, dealId);
    assertCanWrite(ctx, deal);
    if (deal.stageId !== before.stageId) throw conflict("The deal was moved by someone else; reload and try again");

    const target = await columnOf(tx, ctx, input.stageId, dealId);
    const index = insertIndex(ctx, target, input.position);
    target.splice(index, 0, { id: dealId, ownerId: deal.ownerId });

    await tx
      .update(deals)
      .set({ stageId: input.stageId })
      .where(and(eq(deals.workspaceId, ctx.workspaceId), eq(deals.id, dealId)));
    await renumber(tx, ctx, target.map((d) => d.id));
    if (deal.stageId !== input.stageId) {
      const source = await columnOf(tx, ctx, deal.stageId, dealId);
      await renumber(tx, ctx, source.map((d) => d.id));
    }

    await audit(tx, {
      ...ctx,
      action: "deal.move",
      entity: "deal",
      entityId: dealId,
      meta: { fromStageId: deal.stageId, fromPosition: deal.position, toStageId: input.stageId, toPosition: index },
    });
    return toDeal(await findDeal(tx, ctx, dealId));
  });
}

export function deleteDeal(ctx: DealActor, dealId: string) {
  return withDbContext(ctx, async (tx) => {
    const before = await findDeal(tx, ctx, dealId);
    assertCanWrite(ctx, before);
    await lockStages(tx, ctx, [before.stageId]);
    const deal = await findDeal(tx, ctx, dealId);
    assertCanWrite(ctx, deal);
    if (deal.stageId !== before.stageId) throw conflict("The deal was moved by someone else; reload and try again");

    // Invoices keep their rows (deal_id is set null).
    await tx.delete(deals).where(and(eq(deals.workspaceId, ctx.workspaceId), eq(deals.id, dealId)));
    const column = await columnOf(tx, ctx, deal.stageId, dealId);
    await renumber(tx, ctx, column.map((d) => d.id));
    await audit(tx, {
      ...ctx,
      action: "deal.delete",
      entity: "deal",
      entityId: dealId,
      meta: { title: deal.title, clientId: deal.clientId, stageId: deal.stageId },
    });
  });
}
