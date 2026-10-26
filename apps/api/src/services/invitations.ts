import type { CreateInvitationInput } from "@crm/shared";
import { and, eq, isNull, sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { setDbContext, withDbContext } from "../db/context";
import { invitations, memberships, users, workspaces } from "../db/schema";
import { conflict, forbidden, gone, notFound } from "../lib/http-error";
import { audit } from "./audit";
import type { TenantRef } from "./workspaces";

export const INVITATION_TTL_DAYS = 7;

// Only the SHA-256 of the token is stored, so a DB leak does not expose usable invite links.
export const hashInvitationToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function createInvitation(ctx: TenantRef, input: CreateInvitationInput) {
  return withDbContext(ctx, async (tx) => {
    const [existing] = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.workspaceId, ctx.workspaceId), eq(sql`lower(${users.email})`, input.email)));
    if (existing) throw conflict("This person is already a member");

    const token = randomBytes(32).toString("base64url");
    const [invitation] = await tx
      .insert(invitations)
      .values({
        workspaceId: ctx.workspaceId,
        email: input.email,
        role: input.role,
        token: hashInvitationToken(token),
        invitedBy: ctx.userId,
        expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 3600 * 1000),
      })
      .returning({ id: invitations.id, email: invitations.email, role: invitations.role, expiresAt: invitations.expiresAt });
    await audit(tx, { ...ctx, action: "invitation.create", entity: "invitation", entityId: invitation!.id, meta: { email: input.email, role: input.role } });
    return { invitation: invitation!, token };
  });
}

/**
 * Accepts an invitation for the signed-in user. The invitee is not yet a member, so the row is found
 * through the invite_by_token policy; every write then runs in the invitation's workspace context.
 */
export function acceptInvitation(user: { id: string; email: string }, token: string) {
  const tokenHash = hashInvitationToken(token);
  return withDbContext({ userId: user.id, inviteTokenHash: tokenHash }, async (tx) => {
    const [invitation] = await tx.select().from(invitations).where(eq(invitations.token, tokenHash));
    if (!invitation) throw notFound("Invitation not found");
    if (invitation.acceptedAt) throw gone("Invitation already used");
    if (invitation.expiresAt.getTime() <= Date.now()) throw gone("Invitation expired");
    if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
      throw forbidden("This invitation was sent to a different email address");
    }

    const ctx = { userId: user.id, workspaceId: invitation.workspaceId };
    await setDbContext(tx, ctx);

    const claimed = await tx
      .update(invitations)
      .set({ acceptedAt: new Date() })
      .where(and(eq(invitations.id, invitation.id), isNull(invitations.acceptedAt)))
      .returning({ id: invitations.id });
    if (claimed.length === 0) throw gone("Invitation already used");

    const inserted = await tx
      .insert(memberships)
      .values({ workspaceId: invitation.workspaceId, userId: user.id, role: invitation.role })
      .onConflictDoNothing()
      .returning({ role: memberships.role });
    if (inserted.length === 0) throw conflict("You are already a member of this workspace");

    await audit(tx, { ...ctx, action: "invitation.accept", entity: "invitation", entityId: invitation.id, meta: { role: invitation.role } });
    const [workspace] = await tx
      .select({ id: workspaces.id, name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, invitation.workspaceId));
    return { workspace: workspace!, role: invitation.role };
  });
}
