import type { Role } from "@crm/shared";
import { and, asc, eq } from "drizzle-orm";
import type { Tx } from "../db/context";
import { withDbContext } from "../db/context";
import { memberships, users, workspaces } from "../db/schema";
import { conflict, notFound } from "../lib/http-error";
import { audit } from "./audit";
import type { TenantRef } from "./workspaces";

export function listMembers(ctx: TenantRef) {
  return withDbContext(ctx, (tx) =>
    tx
      .select({
        userId: memberships.userId,
        name: users.name,
        email: users.email,
        role: memberships.role,
        joinedAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.workspaceId, ctx.workspaceId))
      .orderBy(asc(memberships.createdAt)),
  );
}

// The owner always stays an admin, so a workspace can never lose its last admin.
async function assertNotOwner(tx: Tx, ctx: TenantRef, memberId: string) {
  const [workspace] = await tx.select({ ownerId: workspaces.ownerId }).from(workspaces).where(eq(workspaces.id, ctx.workspaceId));
  if (workspace?.ownerId === memberId) throw conflict("The workspace owner cannot be demoted or removed");
}

export function updateMemberRole(ctx: TenantRef, memberId: string, role: Role) {
  return withDbContext(ctx, async (tx) => {
    // Filtering by workspace is redundant with RLS but keeps intent explicit; RLS still enforces it.
    const [current] = await tx
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.workspaceId, ctx.workspaceId), eq(memberships.userId, memberId)));
    if (!current) throw notFound("Member not found");
    if (role !== "admin") await assertNotOwner(tx, ctx, memberId);

    const [updated] = await tx
      .update(memberships)
      .set({ role })
      .where(and(eq(memberships.workspaceId, ctx.workspaceId), eq(memberships.userId, memberId)))
      .returning({ userId: memberships.userId, role: memberships.role });
    await audit(tx, { ...ctx, action: "member.role_change", entity: "membership", entityId: memberId, meta: { from: current.role, to: role } });
    return updated!;
  });
}

export function removeMember(ctx: TenantRef, memberId: string) {
  return withDbContext(ctx, async (tx) => {
    await assertNotOwner(tx, ctx, memberId);
    const deleted = await tx
      .delete(memberships)
      .where(and(eq(memberships.workspaceId, ctx.workspaceId), eq(memberships.userId, memberId)))
      .returning({ role: memberships.role });
    if (deleted.length === 0) throw notFound("Member not found");
    await audit(tx, { ...ctx, action: "member.remove", entity: "membership", entityId: memberId, meta: { role: deleted[0]!.role } });
  });
}
