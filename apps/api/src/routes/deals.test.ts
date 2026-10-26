import { DEFAULT_PIPELINE_STAGES, ROLES } from "@crm/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sqlClient } from "../db/client";
import { app, cleanup, createTeam, ownerSql } from "../test/helpers";
import type { Team, TestUser } from "../test/helpers";

interface Deal {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  value: number;
  currency: string;
  stageId: string;
  position: number;
  ownerId: string | null;
}
type StageName = (typeof DEFAULT_PIPELINE_STAGES)[number];

let team: Team;
let other: Team;
let stages: Record<StageName, string>;
let clientId: string;

async function stageIds(user: TestUser) {
  const res = await user.agent.get("/api/stages").expect(200);
  return Object.fromEntries(res.body.stages.map((s: { id: string; name: string }) => [s.name, s.id])) as Record<StageName, string>;
}

async function newClient(user: TestUser, name = "Deal Client") {
  const res = await user.agent.post("/api/clients").send({ name }).expect(201);
  return res.body.client.id as string;
}

async function newDeal(user: TestUser, body: Record<string, unknown> = {}, ctx = { stages, clientId }) {
  const res = await user.agent
    .post("/api/deals")
    .send({ title: "Logo package", clientId: ctx.clientId, stageId: ctx.stages.Lead, ...body })
    .expect(201);
  return res.body.deal as Deal;
}

/** Ids of a column in board order, read behind the API's back; also checks positions are 0..n-1. */
async function column(stageId: string) {
  const rows = await ownerSql<{ id: string; position: number }[]>`
    select id, position from deals where stage_id = ${stageId} order by position, created_at, id`;
  expect(rows.map((r) => r.position)).toEqual(rows.map((_, i) => i));
  return rows.map((r) => r.id);
}

async function auditRows(workspaceId: string, entityId: string) {
  return ownerSql<{ action: string; user_id: string; meta: Record<string, unknown> | null }[]>`
    select action, user_id, meta from audit_log where workspace_id = ${workspaceId} and entity_id = ${entityId} order by created_at`;
}

beforeAll(async () => {
  team = await createTeam("deals");
  other = await createTeam("deals-other");
  stages = await stageIds(team.admin);
  clientId = await newClient(team.admin);
});
afterAll(async () => {
  await cleanup();
  await Promise.all([ownerSql.end(), sqlClient.end()]);
});

describe("stages", () => {
  it("lists the default pipeline in order for every role", async () => {
    for (const role of ROLES) {
      const res = await team[role].agent.get("/api/stages").expect(200);
      expect(res.body.stages.map((s: { name: string; position: number }) => [s.name, s.position])).toEqual(
        DEFAULT_PIPELINE_STAGES.map((name, i) => [name, i]),
      );
    }
  });

  it("requires a session", async () => {
    await request(app).get("/api/stages").expect(401);
    await request(app).get("/api/deals").expect(401);
  });
});

describe("role permissions", () => {
  it("every role can create, read, update, move and delete its own deal", async () => {
    for (const role of ROLES) {
      const user = team[role];
      const deal = await newDeal(user, { title: `${role} deal`, value: 1200.5, currency: "eur" });
      expect(deal).toMatchObject({ ownerId: user.id, clientId, clientName: "Deal Client", value: 1200.5, currency: "EUR", stageId: stages.Lead });

      await user.agent.get(`/api/deals/${deal.id}`).expect(200);
      const updated = await user.agent.patch(`/api/deals/${deal.id}`).send({ title: "Renamed", value: 99 }).expect(200);
      expect(updated.body.deal).toMatchObject({ title: "Renamed", value: 99, currency: "EUR" });
      const moved = await user.agent.post(`/api/deals/${deal.id}/move`).send({ stageId: stages.Won, position: 0 }).expect(200);
      expect(moved.body.deal.stageId).toBe(stages.Won);
      await user.agent.delete(`/api/deals/${deal.id}`).expect(204);
      await user.agent.get(`/api/deals/${deal.id}`).expect(404);
    }
  });

  it("seller cannot create a deal for someone else or unassigned", async () => {
    const { agent } = team.seller;
    const base = { title: "X", clientId, stageId: stages.Lead };
    await agent.post("/api/deals").send({ ...base, ownerId: team.pm.id }).expect(403);
    await agent.post("/api/deals").send({ ...base, ownerId: null }).expect(403);
    const own = await newDeal(team.seller, { ownerId: team.seller.id });
    expect(own.ownerId).toBe(team.seller.id);
  });

  it("PM and admin can create deals for others and unassigned", async () => {
    const forSeller = await newDeal(team.pm, { ownerId: team.seller.id });
    expect(forSeller.ownerId).toBe(team.seller.id);
    const unassigned = await newDeal(team.admin, { ownerId: null });
    expect(unassigned.ownerId).toBeNull();
  });

  describe("seller scope", () => {
    let pmDeal: Deal;
    let unassigned: Deal;
    let sellerDeal: Deal;

    beforeAll(async () => {
      const scopeClient = await newClient(team.admin, "Scope Client");
      const ctx = { stages, clientId: scopeClient };
      pmDeal = await newDeal(team.pm, { title: "PM deal" }, ctx);
      unassigned = await newDeal(team.admin, { title: "Open deal", ownerId: null }, ctx);
      sellerDeal = await newDeal(team.seller, { title: "Seller deal" }, ctx);
    });

    it("seller lists only own and unassigned deals; managers list all", async () => {
      const ids = async (user: TestUser) =>
        (await user.agent.get("/api/deals").query({ clientId: pmDeal.clientId }).expect(200)).body.deals.map((d: Deal) => d.id);
      expect(await ids(team.seller)).toEqual([unassigned.id, sellerDeal.id]);
      expect(await ids(team.pm)).toEqual([pmDeal.id, unassigned.id, sellerDeal.id]);
      expect(await ids(team.admin)).toEqual([pmDeal.id, unassigned.id, sellerDeal.id]);
    });

    it("another member's deal is invisible to a seller", async () => {
      const { agent } = team.seller;
      await agent.get(`/api/deals/${pmDeal.id}`).expect(404);
      await agent.patch(`/api/deals/${pmDeal.id}`).send({ title: "Mine now" }).expect(404);
      await agent.post(`/api/deals/${pmDeal.id}/move`).send({ stageId: stages.Won, position: 0 }).expect(404);
      await agent.delete(`/api/deals/${pmDeal.id}`).expect(404);
      const res = await agent.get("/api/deals").query({ ownerId: team.pm.id }).expect(200);
      expect(res.body.deals).toEqual([]);
    });

    it("an unassigned deal is readable but not writable by a seller", async () => {
      const { agent } = team.seller;
      await agent.get(`/api/deals/${unassigned.id}`).expect(200);
      await agent.patch(`/api/deals/${unassigned.id}`).send({ title: "Mine now" }).expect(403);
      await agent.patch(`/api/deals/${unassigned.id}`).send({ ownerId: team.seller.id }).expect(403);
      await agent.post(`/api/deals/${unassigned.id}/move`).send({ stageId: stages.Won, position: 0 }).expect(403);
      await agent.delete(`/api/deals/${unassigned.id}`).expect(403);
    });

    it("seller cannot reassign their own deal", async () => {
      const { agent } = team.seller;
      await agent.patch(`/api/deals/${sellerDeal.id}`).send({ ownerId: team.pm.id }).expect(403);
      await agent.patch(`/api/deals/${sellerDeal.id}`).send({ ownerId: null }).expect(403);
      // Restating the current owner is not a reassignment.
      await agent.patch(`/api/deals/${sellerDeal.id}`).send({ ownerId: team.seller.id }).expect(200);
    });

    it("PM and admin can edit, move, reassign and delete anyone's deal", async () => {
      const deal = await newDeal(team.seller, { title: "Handover" });
      const res = await team.pm.agent.patch(`/api/deals/${deal.id}`).send({ ownerId: team.admin.id }).expect(200);
      expect(res.body.deal.ownerId).toBe(team.admin.id);
      await team.seller.agent.get(`/api/deals/${deal.id}`).expect(404);

      await team.admin.agent.patch(`/api/deals/${deal.id}`).send({ ownerId: null }).expect(200);
      await team.pm.agent.post(`/api/deals/${deal.id}/move`).send({ stageId: stages.Proposal, position: 0 }).expect(200);
      await team.admin.agent.patch(`/api/deals/${deal.id}`).send({ ownerId: team.seller.id }).expect(200);
      await team.seller.agent.patch(`/api/deals/${deal.id}`).send({ value: 10 }).expect(200);
      await team.pm.agent.delete(`/api/deals/${deal.id}`).expect(204);
    });
  });

  it("filters by stage, owner and client", async () => {
    const filterClient = await newClient(team.admin, "Filter Client");
    const ctx = { stages, clientId: filterClient };
    const a = await newDeal(team.seller, {}, ctx);
    const b = await newDeal(team.pm, { stageId: stages.Contacted }, ctx);
    const c = await newDeal(team.pm, { ownerId: team.seller.id, stageId: stages.Contacted }, ctx);
    const ids = async (query: Record<string, string>) =>
      (await team.admin.agent.get("/api/deals").query({ clientId: filterClient, ...query }).expect(200)).body.deals.map((d: Deal) => d.id);

    expect(await ids({})).toEqual([a.id, b.id, c.id]);
    expect(await ids({ stageId: stages.Contacted })).toEqual([b.id, c.id]);
    expect(await ids({ ownerId: team.seller.id })).toEqual([a.id, c.id]);
    expect(await ids({ ownerId: team.seller.id, stageId: stages.Lead })).toEqual([a.id]);
  });
});

describe("reordering", () => {
  // A dedicated workspace so the columns hold only this block's cards.
  let board: Team;
  let s: Record<StageName, string>;
  let ctx: { stages: Record<StageName, string>; clientId: string };
  const ids: Record<string, string> = {};
  const add = async (title: string, stage: StageName, user?: TestUser) => {
    ids[title] = (await newDeal(user ?? board.pm, { title, stageId: s[stage] }, ctx)).id;
  };
  const move = (title: string, stage: StageName, position: number, user?: TestUser) =>
    (user ?? board.pm).agent.post(`/api/deals/${ids[title]}/move`).send({ stageId: s[stage], position }).expect(200);
  const titles = async (stage: StageName) => {
    const byId = Object.fromEntries(Object.entries(ids).map(([t, id]) => [id, t]));
    return (await column(s[stage])).map((id) => byId[id]);
  };

  beforeAll(async () => {
    board = await createTeam("deals-board");
    s = await stageIds(board.admin);
    ctx = { stages: s, clientId: await newClient(board.admin, "Board Client") };
    for (const t of ["A", "B", "C", "D"]) await add(t, "Lead");
    for (const t of ["X", "Y"]) await add(t, "Contacted");
  });

  it("appends new deals at the bottom of their column", async () => {
    expect(await titles("Lead")).toEqual(["A", "B", "C", "D"]);
    expect(await titles("Contacted")).toEqual(["X", "Y"]);
  });

  it("moves down within a column", async () => {
    const res = await move("A", "Lead", 2);
    expect(res.body.deal.position).toBe(2);
    expect(await titles("Lead")).toEqual(["B", "C", "A", "D"]);
  });

  it("moves up within a column", async () => {
    await move("D", "Lead", 0);
    expect(await titles("Lead")).toEqual(["D", "B", "C", "A"]);
  });

  it("keeps the order when dropped in place", async () => {
    await move("B", "Lead", 1);
    expect(await titles("Lead")).toEqual(["D", "B", "C", "A"]);
  });

  it("moves across columns and closes the gap in the source", async () => {
    const res = await move("C", "Contacted", 1);
    expect(res.body.deal).toMatchObject({ stageId: s.Contacted, position: 1 });
    expect(await titles("Lead")).toEqual(["D", "B", "A"]);
    expect(await titles("Contacted")).toEqual(["X", "C", "Y"]);
  });

  it("clamps a position past the end to the last slot", async () => {
    const res = await move("D", "Contacted", 999);
    expect(res.body.deal.position).toBe(3);
    expect(await titles("Lead")).toEqual(["B", "A"]);
    expect(await titles("Contacted")).toEqual(["X", "C", "Y", "D"]);
  });

  it("moves into an empty column", async () => {
    await move("X", "Won", 5);
    expect(await titles("Won")).toEqual(["X"]);
    expect(await titles("Contacted")).toEqual(["C", "Y", "D"]);
  });

  it("closes the gap when a deal is deleted", async () => {
    await board.pm.agent.delete(`/api/deals/${ids.Y}`).expect(204);
    delete ids.Y;
    expect(await titles("Contacted")).toEqual(["C", "D"]);
  });

  it("lists deals in stage order, then position", async () => {
    const res = await board.pm.agent.get("/api/deals").expect(200);
    expect(res.body.deals.map((d: Deal) => [d.title, d.position])).toEqual([
      ["B", 0],
      ["A", 1],
      ["C", 0],
      ["D", 1],
      ["X", 0],
    ]);
  });

  it("indexes a seller's drop into the cards they can see", async () => {
    // Proposal: P1 (pm), S1 (seller), P2 (pm), S2 (seller). The seller sees S1, S2.
    await add("P1", "Proposal");
    await add("S1", "Proposal", board.seller);
    await add("P2", "Proposal");
    await add("S2", "Proposal", board.seller);
    await add("S3", "Lead", board.seller);
    await add("S4", "Lead", board.seller);

    // Dropped between S1 and S2 in the seller's view: just before S2.
    await move("S3", "Proposal", 1, board.seller);
    expect(await titles("Proposal")).toEqual(["P1", "S1", "P2", "S3", "S2"]);
    // Dropped at the top of the seller's view: just before S1.
    await move("S4", "Proposal", 0, board.seller);
    expect(await titles("Proposal")).toEqual(["P1", "S4", "S1", "P2", "S3", "S2"]);
    // Past the last visible card: the end of the column.
    await move("S1", "Proposal", 3, board.seller);
    expect(await titles("Proposal")).toEqual(["P1", "S4", "P2", "S3", "S2", "S1"]);
  });

  it("keeps columns consistent under concurrent moves", async () => {
    const names = ["A", "B", "C", "D", "X", "S2", "S3", "S4"] as const;
    const targets: StageName[] = ["Lead", "Contacted", "Lost"];
    const results = await Promise.all(
      names.map((t, i) =>
        board.admin.agent.post(`/api/deals/${ids[t]}/move`).send({ stageId: s[targets[i % 3]!], position: i % 2 }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(names.map(() => 200));
    const all = new Set<string>();
    for (const stage of DEFAULT_PIPELINE_STAGES) for (const id of await column(s[stage])) all.add(id);
    expect(all.size).toBe(Object.keys(ids).length);
  });
});

describe("workspace isolation", () => {
  let foreignStages: Record<StageName, string>;
  let foreignClient: string;
  let foreign: Deal;

  beforeAll(async () => {
    foreignStages = await stageIds(other.admin);
    foreignClient = await newClient(other.admin, "Foreign Client");
    foreign = await newDeal(other.admin, { title: "Foreign deal", ownerId: null }, { stages: foreignStages, clientId: foreignClient });
  });

  it("does not list another workspace's stages or deals", async () => {
    const st = await team.admin.agent.get("/api/stages").expect(200);
    expect(st.body.stages.map((x: { id: string }) => x.id)).not.toContain(foreignStages.Lead);
    const res = await team.admin.agent.get("/api/deals").query({ clientId: foreignClient }).expect(200);
    expect(res.body.deals).toEqual([]);
    const all = await team.admin.agent.get("/api/deals").expect(200);
    expect(all.body.deals.map((d: Deal) => d.id)).not.toContain(foreign.id);
  });

  it("answers 404 for every deal route on a foreign id", async () => {
    for (const role of ROLES) {
      const { agent } = team[role];
      await agent.get(`/api/deals/${foreign.id}`).expect(404);
      await agent.patch(`/api/deals/${foreign.id}`).send({ title: "Hijacked" }).expect(404);
      await agent.post(`/api/deals/${foreign.id}/move`).send({ stageId: stages.Won, position: 0 }).expect(404);
      await agent.delete(`/api/deals/${foreign.id}`).expect(404);
    }
    const [row] = await ownerSql<{ title: string; stage_id: string }[]>`select title, stage_id from deals where id = ${foreign.id}`;
    expect(row).toEqual({ title: "Foreign deal", stage_id: foreignStages.Lead });
  });

  it("rejects a foreign client, stage or owner in the body", async () => {
    const { agent } = team.admin;
    const base = { title: "X", clientId, stageId: stages.Lead };
    await agent.post("/api/deals").send({ ...base, clientId: foreignClient }).expect(400);
    await agent.post("/api/deals").send({ ...base, stageId: foreignStages.Lead }).expect(400);
    await agent.post("/api/deals").send({ ...base, ownerId: other.seller.id }).expect(400);

    const deal = await newDeal(team.admin);
    await agent.patch(`/api/deals/${deal.id}`).send({ clientId: foreignClient }).expect(400);
    await agent.patch(`/api/deals/${deal.id}`).send({ ownerId: other.seller.id }).expect(400);
    await agent.post(`/api/deals/${deal.id}/move`).send({ stageId: foreignStages.Won, position: 0 }).expect(400);
    const [row] = await ownerSql<{ client_id: string; stage_id: string; owner_id: string }[]>`
      select client_id, stage_id, owner_id from deals where id = ${deal.id}`;
    expect(row).toEqual({ client_id: clientId, stage_id: stages.Lead, owner_id: team.admin.id });
  });

  it("ignores a workspaceId sent in the body", async () => {
    const deal = await newDeal(team.admin, { workspaceId: other.workspaceId });
    const [row] = await ownerSql<{ workspace_id: string }[]>`select workspace_id from deals where id = ${deal.id}`;
    expect(row!.workspace_id).toBe(team.workspaceId);
  });
});

describe("validation", () => {
  let dealId: string;
  beforeAll(async () => {
    dealId = (await newDeal(team.seller)).id;
  });

  it("rejects bad create bodies", async () => {
    const { agent } = team.seller;
    const base = { title: "X", clientId, stageId: stages.Lead };
    await agent.post("/api/deals").send({}).expect(400);
    await agent.post("/api/deals").send({ ...base, title: "  " }).expect(400);
    await agent.post("/api/deals").send({ ...base, clientId: undefined }).expect(400);
    await agent.post("/api/deals").send({ ...base, stageId: "lead" }).expect(400);
    await agent.post("/api/deals").send({ ...base, value: -1 }).expect(400);
    await agent.post("/api/deals").send({ ...base, value: 1.005 }).expect(400);
    await agent.post("/api/deals").send({ ...base, value: "100" }).expect(400);
    const res = await agent.post("/api/deals").send({ ...base, currency: "dollars" }).expect(400);
    expect(res.body.details.fieldErrors.currency).toBeDefined();
  });

  it("rejects bad updates and keeps unsent fields", async () => {
    const { agent } = team.seller;
    await agent.patch(`/api/deals/${dealId}`).send({}).expect(400);
    // Stage and position only change through /move.
    await agent.patch(`/api/deals/${dealId}`).send({ stageId: stages.Won, position: 0 }).expect(400);
    await agent.patch(`/api/deals/${dealId}`).send({ title: "" }).expect(400);
    await agent.patch(`/api/deals/${dealId}`).send({ value: 500, currency: "gbp" }).expect(200);
    const res = await agent.patch(`/api/deals/${dealId}`).send({ title: "Website" }).expect(200);
    expect(res.body.deal).toMatchObject({ title: "Website", value: 500, currency: "GBP", stageId: stages.Lead });
  });

  it("rejects bad moves", async () => {
    const url = `/api/deals/${dealId}/move`;
    const { agent } = team.seller;
    await agent.post(url).send({}).expect(400);
    await agent.post(url).send({ stageId: stages.Won }).expect(400);
    await agent.post(url).send({ stageId: stages.Won, position: -1 }).expect(400);
    await agent.post(url).send({ stageId: stages.Won, position: 1.5 }).expect(400);
    await agent.post(url).send({ stageId: stages.Won, position: "0" }).expect(400);
    await agent.post(url).send({ stageId: "won", position: 0 }).expect(400);
  });

  it("rejects malformed ids and filters", async () => {
    const { agent } = team.seller;
    await agent.get("/api/deals/123").expect(400);
    await agent.post("/api/deals/123/move").send({ stageId: stages.Won, position: 0 }).expect(400);
    await agent.get("/api/deals").query({ stageId: "lead" }).expect(400);
    await agent.get("/api/deals").query({ ownerId: "me" }).expect(400);
  });
});

describe("audit log", () => {
  it("records create, update, move and delete with the acting user", async () => {
    const deal = await newDeal(team.seller, { title: "Audited", value: 300 });
    await team.pm.agent.patch(`/api/deals/${deal.id}`).send({ ownerId: team.admin.id }).expect(200);
    await team.admin.agent.post(`/api/deals/${deal.id}/move`).send({ stageId: stages.Lost, position: 0 }).expect(200);
    await team.admin.agent.delete(`/api/deals/${deal.id}`).expect(204);

    const rows = await auditRows(team.workspaceId, deal.id);
    expect(rows.map((r) => [r.action, r.user_id])).toEqual([
      ["deal.create", team.seller.id],
      ["deal.update", team.pm.id],
      ["deal.move", team.admin.id],
      ["deal.delete", team.admin.id],
    ]);
    expect(rows[0]!.meta).toEqual({ title: "Audited", clientId, stageId: stages.Lead, ownerId: team.seller.id, value: 300 });
    expect(rows[1]!.meta).toEqual({ fields: ["ownerId"], fromOwnerId: team.seller.id, toOwnerId: team.admin.id });
    expect(rows[2]!.meta).toMatchObject({ fromStageId: stages.Lead, toStageId: stages.Lost, toPosition: 0 });
  });

  it("writes nothing when the request is rejected", async () => {
    const deal = await newDeal(team.pm);
    await team.seller.agent.patch(`/api/deals/${deal.id}`).send({ title: "Nope" }).expect(404);
    await team.pm.agent.patch(`/api/deals/${deal.id}`).send({ ownerId: other.pm.id }).expect(400);
    await team.pm.agent.post(`/api/deals/${deal.id}/move`).send({ stageId: stages.Won, position: -1 }).expect(400);
    const rows = await auditRows(team.workspaceId, deal.id);
    expect(rows.map((r) => r.action)).toEqual(["deal.create"]);
  });
});
