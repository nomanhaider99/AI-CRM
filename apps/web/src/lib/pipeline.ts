import type { Role } from "@crm/shared";
import { can } from "@crm/shared";
import type { Deal, Stage } from "./types";

// Pure Kanban logic, kept free of React so the board's move and rollback rules are unit tested.

/** Deal ids per stage id, in board order. */
export type Columns = Record<string, string[]>;

/** Droppable ids for columns are prefixed so they never collide with deal ids. */
export const COLUMN_PREFIX = "stage:";
export const columnId = (stageId: string) => `${COLUMN_PREFIX}${stageId}`;
export const stageIdOf = (droppableId: string) => (droppableId.startsWith(COLUMN_PREFIX) ? droppableId.slice(COLUMN_PREFIX.length) : null);

export function toColumns(stages: Stage[], deals: Deal[]): Columns {
  const columns: Columns = Object.fromEntries(stages.map((s) => [s.id, [] as string[]]));
  const sorted = [...deals].sort((a, b) => a.position - b.position);
  for (const d of sorted) columns[d.stageId]?.push(d.id);
  return columns;
}

export function findStage(columns: Columns, dealId: string): string | undefined {
  return Object.keys(columns).find((stageId) => columns[stageId]!.includes(dealId));
}

/**
 * Moves a deal to `index` in `toStage` (clamped), returning new columns. The index is the deal's
 * final place in the target column, the same meaning as `position` in POST /deals/:id/move.
 */
export function moveInColumns(columns: Columns, dealId: string, toStage: string, index: number): Columns {
  const fromStage = findStage(columns, dealId);
  if (!fromStage || !columns[toStage]) return columns;
  const next: Columns = { ...columns, [fromStage]: columns[fromStage]!.filter((id) => id !== dealId) };
  const target = [...next[toStage]!];
  target.splice(Math.max(0, Math.min(index, target.length)), 0, dealId);
  next[toStage] = target;
  return next;
}

/** Where a deal sits: its stage and 0-based index in that column. */
export function locate(columns: Columns, dealId: string): { stageId: string; index: number } | null {
  const stageId = findStage(columns, dealId);
  return stageId ? { stageId, index: columns[stageId]!.indexOf(dealId) } : null;
}

/** Rewrites each deal's stage and position from the columns (the optimistic cache update). */
export function applyColumns(deals: Deal[], columns: Columns): Deal[] {
  const placed = new Map<string, { stageId: string; position: number }>();
  for (const [stageId, ids] of Object.entries(columns)) ids.forEach((id, position) => placed.set(id, { stageId, position }));
  return deals.map((d) => {
    const p = placed.get(d.id);
    return p && (p.stageId !== d.stageId || p.position !== d.position) ? { ...d, ...p } : d;
  });
}

/** Managers move any deal; sellers only their own (unassigned deals are visible to them but locked). */
export const canChangeDeal = (role: Role, userId: string, deal: Pick<Deal, "ownerId">) =>
  can(role, "deals:write_any") || deal.ownerId === userId;

/** Owner filter: "" all, "me", "unassigned" or a member's user id. */
export interface DealFilter {
  owner: string;
  q: string;
}

export function matchesFilter(deal: Deal, filter: DealFilter, userId: string): boolean {
  const { owner } = filter;
  if (owner === "unassigned" && deal.ownerId !== null) return false;
  if (owner === "me" && deal.ownerId !== userId) return false;
  if (owner !== "" && owner !== "me" && owner !== "unassigned" && deal.ownerId !== owner) return false;
  const q = filter.q.trim().toLowerCase();
  return q === "" || deal.title.toLowerCase().includes(q) || deal.clientName.toLowerCase().includes(q);
}

/** Column total per currency, e.g. [{ currency: "USD", total: 1200 }]. */
export function totalsByCurrency(deals: Deal[]): { currency: string; total: number }[] {
  const sums = new Map<string, number>();
  for (const d of deals) sums.set(d.currency, (sums.get(d.currency) ?? 0) + d.value);
  return [...sums].map(([currency, total]) => ({ currency, total: Math.round(total * 100) / 100 }));
}
