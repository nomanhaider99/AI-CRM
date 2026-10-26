import type { Permission, Role } from "@crm/shared";
import { can, PERMISSION_NAMES, ROLES } from "@crm/shared";
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sqlClient } from "../db/client";
import { app, cleanup, createTeam, ownerSql, PASSWORD, signUp } from "../test/helpers";
import type { Team, TestUser } from "../test/helpers";
import { authorize } from "./auth";
import { errorHandler } from "./errors";

// docs/SPEC.md section 3, transcribed independently of packages/shared/src/permissions.ts.
const Y = true;
const N = false;
const SPEC: Record<Permission, Record<Role, boolean>> = {
  "workspace:manage": { admin: Y, pm: N, seller: N }, // Manage workspace, members, roles, plan
  "members:read": { admin: Y, pm: Y, seller: Y },
  "clients:read": { admin: Y, pm: Y, seller: Y }, // View all clients
  "clients:write": { admin: Y, pm: Y, seller: Y }, // Create / edit clients
  "clients:delete": { admin: Y, pm: N, seller: N }, // Delete clients
  "deals:read": { admin: Y, pm: Y, seller: Y }, // seller: own + unassigned
  "deals:read_any": { admin: Y, pm: Y, seller: N }, // View all deals
  "deals:write": { admin: Y, pm: Y, seller: Y }, // Create / move deals (seller: own)
  "deals:write_any": { admin: Y, pm: Y, seller: N },
  "deals:reassign": { admin: Y, pm: Y, seller: N }, // Reassign deals
  "invoices:read": { admin: Y, pm: Y, seller: Y },
  "invoices:write": { admin: Y, pm: Y, seller: Y }, // Create / edit invoices (seller: own deals only)
  "invoices:write_any": { admin: Y, pm: Y, seller: N },
  "invoices:delete": { admin: Y, pm: N, seller: N }, // Delete invoices
  "ai:use": { admin: Y, pm: Y, seller: Y }, // Use AI agent
  "audit:read": { admin: Y, pm: Y, seller: N }, // View audit log
};

describe("permission matrix", () => {
  it("covers exactly the permissions the spec table lists", () => {
    expect([...PERMISSION_NAMES].sort()).toEqual(Object.keys(SPEC).sort());
  });

  for (const permission of PERMISSION_NAMES) {
    for (const role of ROLES) {
      it(`${role} ${SPEC[permission][role] ? "can" : "cannot"} ${permission}`, () => {
        expect(can(role, permission)).toBe(SPEC[permission][role]);
      });
    }
  }
});

describe("role middleware with real sessions", () => {
  let team: Team;
  let outsider: TestUser;
  const users = (): Record<Role, TestUser> => ({ admin: team.admin, pm: team.pm, seller: team.seller });

  // A probe route per permission, guarded by the same middleware chain the real routes use.
  const probe = express();
  probe.use(cookieParser());
  // Paths use the index: a ":" in an Express path would start a route parameter.
  PERMISSION_NAMES.forEach((p, i) => probe.get(`/probe/${i}`, ...authorize(p), (_req, res) => void res.json({ ok: true })));
  const probePath = (p: Permission) => `/probe/${PERMISSION_NAMES.indexOf(p)}`;
  probe.use(errorHandler);

  beforeAll(async () => {
    team = await createTeam("perm");
    outsider = await signUp("perm-outsider");
  });
  afterAll(async () => {
    await cleanup();
    await Promise.all([ownerSql.end(), sqlClient.end()]);
  });

  // A fresh login yields a session cookie for the user's (only) workspace, usable against the probe app.
  const cookieOf = async (user: TestUser) => {
    const res = await request(app).post("/api/auth/login").send({ email: user.email, password: PASSWORD }).expect(200);
    const raw = res.headers["set-cookie"] as unknown as string[];
    return raw.find((c) => c.startsWith("crm_session="))?.split(";")[0] ?? "";
  };

  it("enforces every permission for every role", async () => {
    for (const role of ROLES) {
      const cookie = await cookieOf(users()[role]);
      for (const p of PERMISSION_NAMES) {
        const res = await request(probe).get(probePath(p)).set("Cookie", cookie);
        expect(res.status, `${role} -> ${p}`).toBe(SPEC[p][role] ? 200 : 403);
      }
    }
  });

  it("rejects unauthenticated and workspace-less users on every route", async () => {
    const cookie = await cookieOf(outsider);
    for (const p of PERMISSION_NAMES) {
      await request(probe).get(probePath(p)).expect(401);
      await request(probe).get(probePath(p)).set("Cookie", cookie).expect(403);
    }
  });

  describe("real routes", () => {
    it("every role can read the workspace and its members", async () => {
      for (const user of Object.values(users())) {
        await user.agent.get("/api/workspaces/current").expect(200);
        await user.agent.get("/api/members").expect(200);
      }
    });

    it("pm and seller cannot manage the workspace, members, roles or invitations", async () => {
      for (const user of [team.pm, team.seller]) {
        await user.agent.patch("/api/workspaces/current").send({ name: "Hijacked" }).expect(403);
        await user.agent.post("/api/invitations").send({ email: "new@example.com", role: "seller" }).expect(403);
        await user.agent.patch(`/api/members/${team.seller.id}`).send({ role: "admin" }).expect(403);
        await user.agent.delete(`/api/members/${team.seller.id}`).expect(403);
      }
      const [row] = await ownerSql<{ role: string }[]>`
        select role from memberships where workspace_id = ${team.workspaceId} and user_id = ${team.seller.id}`;
      expect(row?.role).toBe("seller");
    });

    it("admin can manage the workspace, invite, change roles and remove members", async () => {
      await team.admin.agent.patch("/api/workspaces/current").send({ name: "Perm renamed" }).expect(200);
      await team.admin.agent.post("/api/invitations").send({ email: "new@example.com", role: "seller" }).expect(201);
      await team.admin.agent.patch(`/api/members/${team.seller.id}`).send({ role: "pm" }).expect(200);
      // The new role applies on the very next request, without a new token.
      await team.seller.agent.get("/api/workspaces/current").expect(200).expect((r) => expect(r.body.workspace.role).toBe("pm"));
      await team.admin.agent.patch(`/api/members/${team.seller.id}`).send({ role: "seller" }).expect(200);

      const extra = await signUp("perm-extra");
      const inv = await team.admin.agent.post("/api/invitations").send({ email: extra.email, role: "seller" }).expect(201);
      await extra.agent.post(`/api/invitations/${inv.body.token}/accept`).expect(200);
      await team.admin.agent.delete(`/api/members/${extra.id}`).expect(204);
    });

    it("the owner cannot be demoted or removed, so a workspace always keeps an admin", async () => {
      await team.admin.agent.patch(`/api/members/${team.admin.id}`).send({ role: "seller" }).expect(409);
      await team.admin.agent.delete(`/api/members/${team.admin.id}`).expect(409);
    });

    it("rejects an invalid role value", async () => {
      await team.admin.agent.patch(`/api/members/${team.seller.id}`).send({ role: "owner" }).expect(400);
    });

    it("writes an audit log entry for each membership change", async () => {
      const rows = await ownerSql<{ action: string }[]>`
        select action from audit_log where workspace_id = ${team.workspaceId}`;
      const actions = rows.map((r) => r.action);
      for (const a of ["workspace.create", "invitation.create", "invitation.accept", "member.role_change", "member.remove", "workspace.update"]) {
        expect(actions).toContain(a);
      }
    });
  });
});
