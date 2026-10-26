import { createWorkspaceSchema, idSchema, updateWorkspaceSchema } from "@crm/shared";
import { Router } from "express";
import { setSessionCookie } from "../auth/session";
import { notFound } from "../lib/http-error";
import { parse } from "../lib/validate";
import { authorize, requireAuth, requireWorkspace, sessionOf, tenantOf } from "../middleware/auth";
import { listUserWorkspaces } from "../services/auth";
import { createWorkspace, getWorkspace, updateWorkspace } from "../services/workspaces";

export const workspacesRouter = Router();

// Any signed-in user can create a workspace; they become its admin and it becomes active.
workspacesRouter.post("/", requireAuth, async (req, res) => {
  const session = sessionOf(req);
  const { name } = parse(createWorkspaceSchema, req.body);
  const workspace = await createWorkspace(session.userId, name);
  await setSessionCookie(res, { ...session, workspaceId: workspace.id });
  res.status(201).json({ workspace: { ...workspace, role: "admin" } });
});

workspacesRouter.get("/current", requireAuth, requireWorkspace, async (req, res) => {
  const tenant = tenantOf(req);
  const workspace = await getWorkspace(tenant);
  res.json({ workspace: { ...workspace, role: tenant.role } });
});

workspacesRouter.patch("/current", ...authorize("workspace:manage"), async (req, res) => {
  const tenant = tenantOf(req);
  const workspace = await updateWorkspace(tenant, parse(updateWorkspaceSchema, req.body));
  res.json({ workspace: { ...workspace, role: tenant.role } });
});

// Switch the active workspace. Only workspaces the user is a member of can be selected.
workspacesRouter.post("/:id/switch", requireAuth, async (req, res) => {
  const session = sessionOf(req);
  const workspaceId = parse(idSchema, req.params.id);
  const workspace = (await listUserWorkspaces(session.userId)).find((w) => w.id === workspaceId);
  if (!workspace) throw notFound("Workspace not found");
  await setSessionCookie(res, { ...session, workspaceId });
  res.json({ workspace });
});
