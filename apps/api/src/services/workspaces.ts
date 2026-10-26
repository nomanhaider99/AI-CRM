import type { UpdateWorkspaceInput } from "@crm/shared";
import { DEFAULT_PIPELINE_STAGES } from "@crm/shared";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { withDbContext } from "../db/context";
import { memberships, pipelineStages, workspaces } from "../db/schema";
import { notFound } from "../lib/http-error";
import { audit } from "./audit";

const workspaceFields = {
  id: workspaces.id,
  name: workspaces.name,
  plan: workspaces.plan,
  aiModel: workspaces.aiModel,
  ownerId: workspaces.ownerId,
  createdAt: workspaces.createdAt,
};

export interface TenantRef {
  userId: string;
  workspaceId: string;
}

/** Creates a workspace with the creator as admin and the default pipeline stages. */
export function createWorkspace(userId: string, name: string) {
  // The id is chosen up front so the whole insert runs inside that workspace's RLS context.
  const workspaceId = randomUUID();
  return withDbContext({ userId, workspaceId }, async (tx) => {
    const [workspace] = await tx
      .insert(workspaces)
      .values({ id: workspaceId, name, ownerId: userId })
      .returning(workspaceFields);
    await tx.insert(memberships).values({ workspaceId, userId, role: "admin" });
    await tx
      .insert(pipelineStages)
      .values(DEFAULT_PIPELINE_STAGES.map((stage, position) => ({ workspaceId, name: stage, position })));
    await audit(tx, { workspaceId, userId, action: "workspace.create", entity: "workspace", entityId: workspaceId });
    return workspace!;
  });
}

export function getWorkspace(ctx: TenantRef) {
  return withDbContext(ctx, async (tx) => {
    const [workspace] = await tx.select(workspaceFields).from(workspaces).where(eq(workspaces.id, ctx.workspaceId));
    if (!workspace) throw notFound("Workspace not found");
    return workspace;
  });
}

export function updateWorkspace(ctx: TenantRef, input: UpdateWorkspaceInput) {
  return withDbContext(ctx, async (tx) => {
    const [workspace] = await tx
      .update(workspaces)
      .set(input)
      .where(eq(workspaces.id, ctx.workspaceId))
      .returning(workspaceFields);
    if (!workspace) throw notFound("Workspace not found");
    await audit(tx, { ...ctx, action: "workspace.update", entity: "workspace", entityId: ctx.workspaceId, meta: input });
    return workspace;
  });
}
