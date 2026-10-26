import type { Role } from "@crm/shared";
import { ROLES } from "@crm/shared";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sqlClient } from "../db/client";
import { app, cleanup, createTeam, ownerSql } from "../test/helpers";
import type { Team, TestUser } from "../test/helpers";

let team: Team;
let other: Team;
const users = (): Record<Role, TestUser> => ({ admin: team.admin, pm: team.pm, seller: team.seller });

beforeAll(async () => {
  team = await createTeam("clients");
  other = await createTeam("clients-other");
});
afterAll(async () => {
  await cleanup();
  await Promise.all([ownerSql.end(), sqlClient.end()]);
});

async function newClient(user: TestUser, body: Record<string, unknown> = {}) {
  const res = await user.agent
    .post("/api/clients")
    .send({ name: "John Smith", ...body })
    .expect(201);
  return res.body.client as { id: string; name: string; ownerId: string; status: string };
}

async function auditRows(workspaceId: string, entityId: string) {
  return ownerSql<{ action: string; user_id: string; meta: Record<string, unknown> | null }[]>`
    select action, user_id, meta from audit_log where workspace_id = ${workspaceId} and entity_id = ${entityId} order by created_at`;
}

describe("role permissions", () => {
  for (const role of ROLES) {
    it(`${role} can list, create, read, update clients and add and list events`, async () => {
      const user = users()[role];
      const client = await newClient(user, { company: `${role} Ltd` });
      expect(client.ownerId).toBe(user.id);

      await user.agent.get(`/api/clients/${client.id}`).expect(200);
      const updated = await user.agent.patch(`/api/clients/${client.id}`).send({ status: "active" }).expect(200);
      expect(updated.body.client.status).toBe("active");
      expect(updated.body.client.name).toBe("John Smith");

      const list = await user.agent.get("/api/clients").query({ search: `${role} Ltd` }).expect(200);
      expect(list.body.clients.map((c: { id: string }) => c.id)).toEqual([client.id]);

      await user.agent.post(`/api/clients/${client.id}/events`).send({ type: "note", title: "First call went well" }).expect(201);
      const events = await user.agent.get(`/api/clients/${client.id}/events`).expect(200);
      expect(events.body.total).toBe(1);
    });
  }

  it("only admin can delete clients", async () => {
    const client = await newClient(team.seller);
    await team.seller.agent.delete(`/api/clients/${client.id}`).expect(403);
    await team.pm.agent.delete(`/api/clients/${client.id}`).expect(403);
    await team.admin.agent.delete(`/api/clients/${client.id}`).expect(204);
    await team.admin.agent.get(`/api/clients/${client.id}`).expect(404);
    await team.admin.agent.delete(`/api/clients/${client.id}`).expect(404);
  });

  it("deleting a client removes its timeline", async () => {
    const client = await newClient(team.admin);
    await team.admin.agent.post(`/api/clients/${client.id}/events`).send({ type: "call", title: "Intro" }).expect(201);
    await team.admin.agent.delete(`/api/clients/${client.id}`).expect(204);
    const [row] = await ownerSql<{ n: number }[]>`select count(*)::int as n from client_events where client_id = ${client.id}`;
    expect(row!.n).toBe(0);
  });

  it("refuses to delete a client that still has invoices", async () => {
    const client = await newClient(team.admin);
    await ownerSql`insert into invoices (workspace_id, client_id, number, issue_date)
      values (${team.workspaceId}, ${client.id}, ${`INV-${client.id.slice(0, 8)}`}, '2026-10-01')`;
    await team.admin.agent.delete(`/api/clients/${client.id}`).expect(409);
  });

  it("requires a session", async () => {
    await request(app).get("/api/clients").expect(401);
    await request(app).post("/api/clients").send({ name: "X" }).expect(401);
  });
});

describe("workspace isolation", () => {
  let foreign: { id: string };

  beforeAll(async () => {
    foreign = await newClient(other.admin, { name: "Foreign Client", email: "foreign@example.com" });
    await other.admin.agent.post(`/api/clients/${foreign.id}/events`).send({ type: "sale", title: "Secret sale", amount: 999 }).expect(201);
  });

  it("does not list another workspace's clients", async () => {
    const res = await team.admin.agent.get("/api/clients").query({ search: "Foreign Client", limit: 100 }).expect(200);
    expect(res.body.clients).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it("answers 404 for every client route on a foreign id", async () => {
    for (const role of ROLES) {
      const { agent } = users()[role];
      await agent.get(`/api/clients/${foreign.id}`).expect(404);
      await agent.patch(`/api/clients/${foreign.id}`).send({ name: "Hijacked" }).expect(404);
      await agent.get(`/api/clients/${foreign.id}/events`).expect(404);
      await agent.post(`/api/clients/${foreign.id}/events`).send({ type: "note", title: "Injected" }).expect(404);
    }
    await team.admin.agent.delete(`/api/clients/${foreign.id}`).expect(404);

    const [row] = await ownerSql<{ name: string; events: number }[]>`
      select name, (select count(*)::int from client_events where client_id = c.id) as events from clients c where id = ${foreign.id}`;
    expect(row).toEqual({ name: "Foreign Client", events: 1 });
  });

  it("ignores a workspaceId sent in the body", async () => {
    const client = await newClient(team.admin, { workspaceId: other.workspaceId });
    const [row] = await ownerSql<{ workspace_id: string }[]>`select workspace_id from clients where id = ${client.id}`;
    expect(row!.workspace_id).toBe(team.workspaceId);
  });

  it("rejects an owner from another workspace", async () => {
    await team.admin.agent.post("/api/clients").send({ name: "X", ownerId: other.seller.id }).expect(400);
    const client = await newClient(team.admin);
    await team.admin.agent.patch(`/api/clients/${client.id}`).send({ ownerId: other.seller.id }).expect(400);
  });

  it("accepts an owner from the same workspace", async () => {
    const client = await newClient(team.pm, { ownerId: team.seller.id });
    expect(client.ownerId).toBe(team.seller.id);
  });
});

describe("validation", () => {
  let clientId: string;
  beforeAll(async () => {
    clientId = (await newClient(team.seller)).id;
  });

  it("rejects bad client bodies", async () => {
    const { agent } = team.seller;
    await agent.post("/api/clients").send({}).expect(400);
    await agent.post("/api/clients").send({ name: "   " }).expect(400);
    await agent.post("/api/clients").send({ name: "A", email: "not-an-email" }).expect(400);
    await agent.post("/api/clients").send({ name: "A", status: "vip" }).expect(400);
    await agent.post("/api/clients").send({ name: "A", ownerId: "nope" }).expect(400);
    const res = await agent.post("/api/clients").send({ name: "x".repeat(201) }).expect(400);
    expect(res.body.details.fieldErrors.name).toBeDefined();
  });

  it("rejects bad updates and keeps unsent fields", async () => {
    const { agent } = team.seller;
    await agent.patch(`/api/clients/${clientId}`).send({}).expect(400);
    await agent.patch(`/api/clients/${clientId}`).send({ status: "vip" }).expect(400);
    await agent.patch(`/api/clients/${clientId}`).send({ status: "inactive", email: "j@example.com" }).expect(200);
    const res = await agent.patch(`/api/clients/${clientId}`).send({ phone: "+1 555 0100", email: null }).expect(200);
    expect(res.body.client).toMatchObject({ status: "inactive", phone: "+1 555 0100", email: null });
  });

  it("rejects malformed ids", async () => {
    await team.seller.agent.get("/api/clients/123").expect(400);
    await team.seller.agent.post("/api/clients/123/events").send({ type: "note", title: "x" }).expect(400);
  });

  it("rejects bad events", async () => {
    const { agent } = team.seller;
    const url = `/api/clients/${clientId}/events`;
    await agent.post(url).send({ type: "email", title: "x" }).expect(400);
    await agent.post(url).send({ type: "note" }).expect(400);
    await agent.post(url).send({ type: "sale", title: "x", amount: -5 }).expect(400);
    await agent.post(url).send({ type: "sale", title: "x", amount: 10.005 }).expect(400);
    await agent.post(url).send({ type: "sale", title: "x", amount: "50" }).expect(400);
  });

  it("rejects bad pagination", async () => {
    const { agent } = team.seller;
    await agent.get("/api/clients").query({ limit: 0 }).expect(400);
    await agent.get("/api/clients").query({ limit: 101 }).expect(400);
    await agent.get("/api/clients").query({ offset: -1 }).expect(400);
    await agent.get(`/api/clients/${clientId}/events`).query({ limit: "abc" }).expect(400);
  });
});

describe("events", () => {
  it("stores every event type with an optional amount, newest first", async () => {
    const client = await newClient(team.seller);
    const url = `/api/clients/${client.id}/events`;
    const sale = await team.seller.agent.post(url).send({ type: "sale", title: "3 logo designs", body: "Paid upfront", amount: 150.5 }).expect(201);
    expect(sale.body.event).toMatchObject({ type: "sale", amount: 150.5, createdBy: team.seller.id, clientId: client.id });
    for (const type of ["note", "call", "message", "invoice"]) {
      const res = await team.seller.agent.post(url).send({ type, title: `${type} event` }).expect(201);
      expect(res.body.event.amount).toBeNull();
    }

    const res = await team.pm.agent.get(url).expect(200);
    expect(res.body.total).toBe(5);
    expect(res.body.events.map((e: { type: string }) => e.type)).toEqual(["invoice", "message", "call", "note", "sale"]);

    const page = await team.pm.agent.get(url).query({ limit: 2, offset: 4 }).expect(200);
    expect(page.body.events.map((e: { type: string }) => e.type)).toEqual(["sale"]);
  });
});

describe("search and pagination", () => {
  const tag = `pg${Date.now()}`;
  let ids: string[];

  beforeAll(async () => {
    ids = [];
    for (let i = 0; i < 7; i++) {
      const c = await newClient(team.admin, { name: `${tag} Client ${i}`, company: i === 3 ? "Acme 100%" : undefined });
      ids.push(c.id);
    }
  });

  it("pages through results newest first with a stable total", async () => {
    const seen: string[] = [];
    for (let offset = 0; offset < 9; offset += 3) {
      const res = await team.seller.agent.get("/api/clients").query({ search: tag, limit: 3, offset }).expect(200);
      expect(res.body).toMatchObject({ total: 7, limit: 3, offset });
      seen.push(...res.body.clients.map((c: { id: string }) => c.id));
    }
    expect(seen).toEqual([...ids].reverse());
  });

  it("defaults to 25 per page", async () => {
    const res = await team.seller.agent.get("/api/clients").expect(200);
    expect(res.body.limit).toBe(25);
    expect(res.body.offset).toBe(0);
  });

  it("matches name, company and email case-insensitively", async () => {
    const byEmail = await newClient(team.admin, { name: "Zed", email: `${tag}@Example.com` });
    const res = await team.admin.agent.get("/api/clients").query({ search: tag.toUpperCase(), limit: 100 }).expect(200);
    expect(res.body.total).toBe(8);
    expect(res.body.clients[0].id).toBe(byEmail.id);

    const company = await team.admin.agent.get("/api/clients").query({ search: "acme 100%" }).expect(200);
    expect(company.body.clients.map((c: { id: string }) => c.id)).toContain(ids[3]);
  });

  it("treats LIKE wildcards literally", async () => {
    const res = await team.admin.agent.get("/api/clients").query({ search: `${tag}%Client` }).expect(200);
    expect(res.body.total).toBe(0);
  });

  it("filters by status", async () => {
    await team.admin.agent.patch(`/api/clients/${ids[0]}`).send({ status: "active" }).expect(200);
    const res = await team.admin.agent.get("/api/clients").query({ search: tag, status: "active" }).expect(200);
    expect(res.body.clients.map((c: { id: string }) => c.id)).toEqual([ids[0]]);
  });
});

describe("audit log", () => {
  it("records create, update, delete and event create with the acting user", async () => {
    const client = await newClient(team.seller, { name: "Audited" });
    await team.pm.agent.patch(`/api/clients/${client.id}`).send({ notes: "VIP" }).expect(200);
    const event = await team.seller.agent.post(`/api/clients/${client.id}/events`).send({ type: "sale", title: "Sale", amount: 20 }).expect(201);
    await team.admin.agent.delete(`/api/clients/${client.id}`).expect(204);

    const rows = await auditRows(team.workspaceId, client.id);
    expect(rows.map((r) => [r.action, r.user_id])).toEqual([
      ["client.create", team.seller.id],
      ["client.update", team.pm.id],
      ["client.delete", team.admin.id],
    ]);
    expect(rows[1]!.meta).toEqual({ fields: ["notes"] });

    const [eventRow] = await auditRows(team.workspaceId, event.body.event.id);
    expect(eventRow).toMatchObject({ action: "client_event.create", user_id: team.seller.id, meta: { clientId: client.id, type: "sale", amount: 20 } });
  });

  it("writes nothing when the request is rejected", async () => {
    const client = await newClient(team.admin);
    await team.seller.agent.delete(`/api/clients/${client.id}`).expect(403);
    await team.seller.agent.patch(`/api/clients/${client.id}`).send({ status: "vip" }).expect(400);
    const rows = await auditRows(team.workspaceId, client.id);
    expect(rows.map((r) => r.action)).toEqual(["client.create"]);
  });
});
