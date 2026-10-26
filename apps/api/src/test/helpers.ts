import type { Role } from "@crm/shared";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import request from "supertest";
import { createApp } from "../app";
import { SESSION_COOKIE } from "../auth/session";
import { env } from "../env";

// Integration tests need a running, migrated DB: `docker compose up -d db && pnpm db:migrate`.
export const app = createApp();
export const PASSWORD = "correct horse battery";

// Owner connection (superuser): only for seeding and inspecting rows behind the API's back.
if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required for integration tests");
export const ownerSql = postgres(env.DATABASE_URL, { max: 2, onnotice: () => {} });

const runId = randomUUID().slice(0, 8);
const EMAIL_DOMAIN = "test.ai-crm.local";
export const uniqueEmail = (label: string) => `${label}-${runId}-${randomUUID().slice(0, 6)}@${EMAIL_DOMAIN}`;

type TestAgent = ReturnType<typeof request.agent>;

export interface TestUser {
  agent: TestAgent;
  id: string;
  email: string;
}

export async function signUp(label: string): Promise<TestUser> {
  const agent = request.agent(app);
  const email = uniqueEmail(label);
  const res = await agent.post("/api/auth/signup").send({ name: label, email, password: PASSWORD }).expect(201);
  return { agent, id: res.body.user.id, email };
}

export async function createWorkspace(user: TestUser, name: string): Promise<string> {
  const res = await user.agent.post("/api/workspaces").send({ name }).expect(201);
  return res.body.workspace.id;
}

/** Invites a new user with the given role through the real invitation flow. */
export async function addMember(admin: TestUser, role: Role, label: string): Promise<TestUser> {
  const member = await signUp(label);
  const inv = await admin.agent.post("/api/invitations").send({ email: member.email, role }).expect(201);
  await member.agent.post(`/api/invitations/${inv.body.token}/accept`).expect(200);
  return member;
}

export interface Team {
  workspaceId: string;
  admin: TestUser;
  pm: TestUser;
  seller: TestUser;
}

export async function createTeam(label: string): Promise<Team> {
  const admin = await signUp(`${label}-admin`);
  const workspaceId = await createWorkspace(admin, `${label} workspace`);
  const pm = await addMember(admin, "pm", `${label}-pm`);
  const seller = await addMember(admin, "seller", `${label}-seller`);
  return { workspaceId, admin, pm, seller };
}

export const sessionCookie = (token: string) => `${SESSION_COOKIE}=${token}`;

/** Deletes everything this test run created (workspaces cascade to all tenant rows). */
export async function cleanup(): Promise<void> {
  const pattern = `%-${runId}-%@${EMAIL_DOMAIN}`;
  await ownerSql`delete from workspaces where owner_id in (select id from users where email like ${pattern})`;
  await ownerSql`delete from users where email like ${pattern}`;
}
