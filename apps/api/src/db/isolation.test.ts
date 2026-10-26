import { sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signSession } from "../auth/session";
import { cleanup, createTeam, ownerSql, sessionCookie, signUp, app } from "../test/helpers";
import type { Team } from "../test/helpers";
import { db, sqlClient } from "./client";
import { withDbContext } from "./context";
import { clients, memberships, tenantTables, workspaces } from "./schema";

// Two independent workspaces. Everything below runs as A and tries to reach B.
let a: Team;
let b: Team;
let bClientId: string;
let bInvitationId: string;

beforeAll(async () => {
  [a, b] = await Promise.all([createTeam("iso-a"), createTeam("iso-b")]);
  // Seed B's data behind the API's back with the owner connection.
  const [client] = await ownerSql<{ id: string }[]>`
    insert into clients (workspace_id, name) values (${b.workspaceId}, 'B secret client') returning id`;
  bClientId = client!.id;
  await ownerSql`insert into clients (workspace_id, name) values (${a.workspaceId}, 'A client')`;
  const [inv] = await ownerSql<{ id: string }[]>`
    insert into invitations (workspace_id, email, role, token, expires_at)
    values (${b.workspaceId}, 'someone@example.com', 'seller', 'b-token-hash', now() + interval '1 day') returning id`;
  bInvitationId = inv!.id;
});

afterAll(async () => {
  await cleanup();
  await Promise.all([ownerSql.end(), sqlClient.end()]);
});

describe("database role", () => {
  it("the API connects as a role that is not a superuser and cannot bypass RLS", async () => {
    const [role] = await db.execute<{ rolsuper: boolean; rolbypassrls: boolean; rolname: string }>(
      sql`select rolname, rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );
    expect(role).toMatchObject({ rolsuper: false, rolbypassrls: false });
  });

  it("the API role owns no tables (owners could skip non-forced RLS)", async () => {
    const owned = await db.execute(sql`select tablename from pg_tables where schemaname = 'public' and tableowner = current_user`);
    expect(owned.length).toBe(0);
  });

  it("RLS is enabled and forced on workspaces and every tenant table", async () => {
    const names = ["workspaces", ...tenantTables.map((t) => getTableConfig(t).name)];
    const rows = await ownerSql<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      select relname, relrowsecurity, relforcerowsecurity from pg_class
      where relnamespace = 'public'::regnamespace and relname in ${ownerSql(names)}`;
    expect(rows.length).toBe(names.length);
    for (const r of rows) expect(r, r.relname).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  });
});

describe("RLS at the database level", () => {
  const asA = () => ({ userId: a.admin.id, workspaceId: a.workspaceId });

  it("A sees zero of B's rows in every tenant table", async () => {
    // Sanity: B actually has rows in several tables.
    const [bRows] = await ownerSql<{ n: number }[]>`select count(*)::int as n from memberships where workspace_id = ${b.workspaceId}`;
    expect(bRows?.n).toBe(3);

    await withDbContext(asA(), async (tx) => {
      for (const table of tenantTables) {
        const name = getTableConfig(table).name;
        const [row] = await tx.execute<{ n: number }>(
          sql`select count(*)::int as n from ${sql.identifier(name)} where workspace_id = ${b.workspaceId}`,
        );
        expect(row?.n, `${name} leaked B rows`).toBe(0);
      }
    });
  });

  it("an unfiltered select only returns A's rows", async () => {
    const rows = await withDbContext(asA(), (tx) => tx.select({ workspaceId: clients.workspaceId }).from(clients));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.workspaceId === a.workspaceId)).toBe(true);
    const ws = await withDbContext(asA(), (tx) => tx.select({ id: workspaces.id }).from(workspaces));
    expect(ws.map((w) => w.id)).toEqual([a.workspaceId]);
  });

  it("A cannot insert rows into B", async () => {
    await expect(
      withDbContext(asA(), (tx) => tx.insert(clients).values({ workspaceId: b.workspaceId, name: "injected" })),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(
      withDbContext(asA(), (tx) => tx.insert(memberships).values({ workspaceId: b.workspaceId, userId: a.admin.id, role: "admin" })),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
  });

  it("A cannot update, move or delete B's rows", async () => {
    await withDbContext(asA(), async (tx) => {
      const updated = await tx.execute(sql`update clients set name = 'pwned' where id = ${bClientId} returning id`);
      expect(updated.length).toBe(0);
      const deleted = await tx.execute(sql`delete from invitations where id = ${bInvitationId} returning id`);
      expect(deleted.length).toBe(0);
      const ws = await tx.execute(sql`update workspaces set name = 'pwned' where id = ${b.workspaceId} returning id`);
      expect(ws.length).toBe(0);
    });
    // Moving A's own row into B is rejected by WITH CHECK.
    await expect(
      withDbContext(asA(), (tx) => tx.execute(sql`update clients set workspace_id = ${b.workspaceId} where workspace_id = ${a.workspaceId}`)),
    ).rejects.toMatchObject({ cause: { code: "42501" } });

    const [client] = await ownerSql<{ name: string }[]>`select name from clients where id = ${bClientId}`;
    expect(client?.name).toBe("B secret client");
    const [inv] = await ownerSql`select id from invitations where id = ${bInvitationId}`;
    expect(inv).toBeDefined();
  });

  it("queries outside any workspace context see no tenant rows", async () => {
    const [c] = await db.execute<{ n: number }>(sql`select count(*)::int as n from clients`);
    const [m] = await db.execute<{ n: number }>(sql`select count(*)::int as n from memberships`);
    const [w] = await db.execute<{ n: number }>(sql`select count(*)::int as n from workspaces`);
    expect([c?.n, m?.n, w?.n]).toEqual([0, 0, 0]);
  });

  it("an invitation is only readable by presenting its token hash", async () => {
    const outsider = { userId: a.admin.id };
    const none = await withDbContext(outsider, (tx) => tx.execute(sql`select id from invitations`));
    expect(none.length).toBe(0);
    const one = await withDbContext({ ...outsider, inviteTokenHash: "b-token-hash" }, (tx) => tx.execute(sql`select id from invitations`));
    expect(one.map((r) => r.id)).toEqual([bInvitationId]);
  });
});

describe("workspace isolation through the API", () => {
  it("lists only the caller's own members", async () => {
    const res = await a.admin.agent.get("/api/members").expect(200);
    const ids = res.body.members.map((m: { userId: string }) => m.userId);
    expect(ids.sort()).toEqual([a.admin.id, a.pm.id, a.seller.id].sort());
  });

  it("returns only the caller's workspace", async () => {
    const res = await a.admin.agent.get("/api/workspaces/current").expect(200);
    expect(res.body.workspace.id).toBe(a.workspaceId);
  });

  it("A's admin cannot change roles or remove members in B", async () => {
    await a.admin.agent.patch(`/api/members/${b.seller.id}`).send({ role: "admin" }).expect(404);
    await a.admin.agent.delete(`/api/members/${b.pm.id}`).expect(404);
    const rows = await ownerSql<{ user_id: string; role: string }[]>`
      select user_id, role from memberships where workspace_id = ${b.workspaceId}`;
    expect(rows.find((r) => r.user_id === b.seller.id)?.role).toBe("seller");
    expect(rows.find((r) => r.user_id === b.pm.id)).toBeDefined();
  });

  it("PATCH /workspaces/current only ever touches the session's workspace", async () => {
    // A workspace_id in the body is not part of the schema and is ignored.
    await a.admin.agent.patch("/api/workspaces/current").send({ name: "A renamed", id: b.workspaceId, workspaceId: b.workspaceId }).expect(200);
    const [bw] = await ownerSql<{ name: string }[]>`select name from workspaces where id = ${b.workspaceId}`;
    expect(bw?.name).toBe("iso-b workspace");
  });

  it("A cannot switch into B", async () => {
    await a.admin.agent.post(`/api/workspaces/${b.workspaceId}/switch`).expect(404);
  });

  it("a validly signed token for a workspace the user is not a member of is rejected", async () => {
    const token = await signSession({ userId: a.admin.id, workspaceId: b.workspaceId, sessionVersion: 0 });
    await request(app).get("/api/members").set("Cookie", sessionCookie(token)).expect(403);
    await request(app).post("/api/invitations").set("Cookie", sessionCookie(token)).send({ email: "x@example.com", role: "admin" }).expect(403);
  });

  it("a removed member loses access on the next request", async () => {
    const team = await createTeam("iso-c");
    await team.seller.agent.get("/api/members").expect(200);
    await team.admin.agent.delete(`/api/members/${team.seller.id}`).expect(204);
    await team.seller.agent.get("/api/members").expect(403);
  });

  it("an invitation cannot be accepted by a different email", async () => {
    const inv = await b.admin.agent.post("/api/invitations").send({ email: "intended@example.com", role: "seller" }).expect(201);
    const intruder = await signUp("intruder");
    await intruder.agent.post(`/api/invitations/${inv.body.token}/accept`).expect(403);
    const [row] = await ownerSql`select 1 from memberships where workspace_id = ${b.workspaceId} and user_id = ${intruder.id}`;
    expect(row).toBeUndefined();
  });

  it("an invitation cannot be reused or used after expiry", async () => {
    const newcomer = await signUp("reuse");
    const inv = await b.admin.agent.post("/api/invitations").send({ email: newcomer.email, role: "seller" }).expect(201);
    await newcomer.agent.post(`/api/invitations/${inv.body.token}/accept`).expect(200);
    await newcomer.agent.post(`/api/invitations/${inv.body.token}/accept`).expect(410);

    const late = await signUp("late");
    const inv2 = await b.admin.agent.post("/api/invitations").send({ email: late.email, role: "seller" }).expect(201);
    await ownerSql`update invitations set expires_at = now() - interval '1 minute' where id = ${inv2.body.invitation.id}`;
    await late.agent.post(`/api/invitations/${inv2.body.token}/accept`).expect(410);
  });

  it("stores only a hash of the invitation token", async () => {
    const inv = await a.admin.agent.post("/api/invitations").send({ email: "hashcheck@example.com", role: "pm" }).expect(201);
    const [row] = await ownerSql<{ token: string }[]>`select token from invitations where id = ${inv.body.invitation.id}`;
    expect(row?.token).not.toBe(inv.body.token);
    expect(row?.token).toMatch(/^[0-9a-f]{64}$/);
  });
});
