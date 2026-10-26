import type { LoginInput, Role, SignupInput } from "@crm/shared";
import { asc, eq, sql } from "drizzle-orm";
import { hashPassword, verifyPassword } from "../auth/password";
import { db } from "../db/client";
import { withDbContext } from "../db/context";
import { memberships, users, workspaces } from "../db/schema";
import { conflict, unauthorized } from "../lib/http-error";

export interface PublicUser {
  id: string;
  email: string;
  name: string;
}

export interface UserWorkspace {
  id: string;
  name: string;
  plan: "free" | "premium";
  role: Role;
}

const publicUser = { id: users.id, email: users.email, name: users.name };

// The users table is global (no workspace_id, no RLS); it only ever holds identity and credentials.
export async function signup(input: SignupInput): Promise<PublicUser & { sessionVersion: number }> {
  const passwordHash = await hashPassword(input.password);
  const [user] = await db
    .insert(users)
    .values({ email: input.email, name: input.name, passwordHash })
    .onConflictDoNothing()
    .returning({ ...publicUser, sessionVersion: users.sessionVersion });
  if (!user) throw conflict("An account with this email already exists");
  return user;
}

export async function login(input: LoginInput): Promise<PublicUser & { sessionVersion: number }> {
  const [user] = await db
    .select({ ...publicUser, passwordHash: users.passwordHash, sessionVersion: users.sessionVersion })
    .from(users)
    .where(eq(sql`lower(${users.email})`, input.email));
  const ok = await verifyPassword(user?.passwordHash, input.password);
  if (!user || !ok) throw unauthorized("Invalid email or password");
  const { passwordHash: _omit, ...rest } = user;
  return rest;
}

/** Revokes every token issued to the user so far. */
export async function revokeSessions(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ sessionVersion: sql`${users.sessionVersion} + 1` })
    .where(eq(users.id, userId));
}

export async function getUser(userId: string): Promise<PublicUser | undefined> {
  const [user] = await db.select(publicUser).from(users).where(eq(users.id, userId));
  return user;
}

/** Workspaces the user belongs to, oldest membership first (read through the own_memberships policy). */
export function listUserWorkspaces(userId: string): Promise<UserWorkspace[]> {
  return withDbContext({ userId }, (tx) =>
    tx
      .select({ id: workspaces.id, name: workspaces.name, plan: workspaces.plan, role: memberships.role })
      .from(memberships)
      .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
      .where(eq(memberships.userId, userId))
      .orderBy(asc(memberships.createdAt)),
  );
}
