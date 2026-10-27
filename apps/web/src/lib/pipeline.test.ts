import { describe, expect, it } from "vitest";
import { applyColumns, canChangeDeal, locate, matchesFilter, moveInColumns, stageIdOf, columnId, toColumns, totalsByCurrency } from "./pipeline";
import type { Deal, Stage } from "./types";

const stages: Stage[] = [
  { id: "lead", name: "Lead", position: 0 },
  { id: "won", name: "Won", position: 1 },
];

const deal = (id: string, stageId: string, position: number, extra: Partial<Deal> = {}): Deal => ({
  id,
  clientId: "c1",
  clientName: "Acme",
  title: `Deal ${id}`,
  value: 100,
  currency: "USD",
  stageId,
  position,
  ownerId: "u1",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...extra,
});

const deals = [deal("b", "lead", 1), deal("a", "lead", 0), deal("c", "won", 0)];

describe("toColumns", () => {
  it("groups deals by stage in position order and keeps empty stages", () => {
    expect(toColumns([...stages, { id: "lost", name: "Lost", position: 2 }], deals)).toEqual({ lead: ["a", "b"], won: ["c"], lost: [] });
  });
});

describe("moveInColumns", () => {
  const columns = toColumns(stages, deals);

  it("moves a deal into another column at the given index", () => {
    expect(moveInColumns(columns, "a", "won", 0)).toEqual({ lead: ["b"], won: ["a", "c"] });
  });

  it("reorders within a column", () => {
    expect(moveInColumns(columns, "a", "lead", 1)).toEqual({ lead: ["b", "a"], won: ["c"] });
  });

  it("clamps an index past the end to the last place", () => {
    expect(moveInColumns(columns, "a", "won", 99)).toEqual({ lead: ["b"], won: ["c", "a"] });
  });

  it("does not mutate the input (the snapshot used for rollback)", () => {
    const before = structuredClone(columns);
    moveInColumns(columns, "a", "won", 0);
    expect(columns).toEqual(before);
  });

  it("ignores unknown deals and stages", () => {
    expect(moveInColumns(columns, "zzz", "won", 0)).toBe(columns);
    expect(moveInColumns(columns, "a", "zzz", 0)).toBe(columns);
  });
});

describe("applyColumns", () => {
  it("rewrites stage and position for moved deals and leaves others untouched", () => {
    const next = applyColumns(deals, { lead: ["b"], won: ["a", "c"] });
    const byId = Object.fromEntries(next.map((d) => [d.id, d]));
    expect(byId.a).toMatchObject({ stageId: "won", position: 0 });
    expect(byId.b).toMatchObject({ stageId: "lead", position: 0 });
    expect(byId.c).toMatchObject({ stageId: "won", position: 1 });
    expect(next.find((d) => d.id === "c")).not.toBe(deals[2]);
    expect(applyColumns(deals, toColumns(stages, deals)).every((d, i) => d === deals[i])).toBe(true);
  });
});

describe("locate and column ids", () => {
  it("finds stage and index", () => {
    expect(locate(toColumns(stages, deals), "b")).toEqual({ stageId: "lead", index: 1 });
    expect(locate(toColumns(stages, deals), "x")).toBeNull();
  });

  it("round-trips column droppable ids", () => {
    expect(stageIdOf(columnId("lead"))).toBe("lead");
    expect(stageIdOf("a")).toBeNull();
  });
});

describe("canChangeDeal", () => {
  it("lets managers change any deal", () => {
    expect(canChangeDeal("admin", "u1", { ownerId: "u2" })).toBe(true);
    expect(canChangeDeal("pm", "u1", { ownerId: null })).toBe(true);
  });

  it("limits sellers to their own deals", () => {
    expect(canChangeDeal("seller", "u1", { ownerId: "u1" })).toBe(true);
    expect(canChangeDeal("seller", "u1", { ownerId: "u2" })).toBe(false);
    expect(canChangeDeal("seller", "u1", { ownerId: null })).toBe(false);
  });
});

describe("matchesFilter", () => {
  const d = deal("a", "lead", 0, { title: "Logo pack", clientName: "Bright Co", ownerId: "u2" });

  it("filters by owner", () => {
    expect(matchesFilter(d, { owner: "", q: "" }, "u1")).toBe(true);
    expect(matchesFilter(d, { owner: "me", q: "" }, "u1")).toBe(false);
    expect(matchesFilter(d, { owner: "me", q: "" }, "u2")).toBe(true);
    expect(matchesFilter(d, { owner: "u2", q: "" }, "u1")).toBe(true);
    expect(matchesFilter(d, { owner: "unassigned", q: "" }, "u1")).toBe(false);
    expect(matchesFilter({ ...d, ownerId: null }, { owner: "unassigned", q: "" }, "u1")).toBe(true);
  });

  it("searches title and client name, case-insensitively", () => {
    expect(matchesFilter(d, { owner: "", q: "logo" }, "u1")).toBe(true);
    expect(matchesFilter(d, { owner: "", q: " BRIGHT " }, "u1")).toBe(true);
    expect(matchesFilter(d, { owner: "", q: "website" }, "u1")).toBe(false);
  });
});

describe("totalsByCurrency", () => {
  it("sums per currency without float drift", () => {
    const list = [deal("a", "lead", 0, { value: 0.1 }), deal("b", "lead", 1, { value: 0.2 }), deal("c", "lead", 2, { value: 5, currency: "EUR" })];
    expect(totalsByCurrency(list)).toEqual([
      { currency: "USD", total: 0.3 },
      { currency: "EUR", total: 5 },
    ]);
  });
});
