import { createInvitationSchema, invitationTokenSchema } from "@crm/shared";
import { Router } from "express";
import { setSessionCookie } from "../auth/session";
import { env } from "../env";
import { notFound } from "../lib/http-error";
import { parse } from "../lib/validate";
import { authorize, requireAuth, sessionOf, tenantOf } from "../middleware/auth";
import { getUser } from "../services/auth";
import { acceptInvitation, createInvitation } from "../services/invitations";

export const invitationsRouter = Router();

// Email sending is out of scope for the demo: the admin copies the returned link to the invitee.
invitationsRouter.post("/", ...authorize("workspace:manage"), async (req, res) => {
  const { invitation, token } = await createInvitation(tenantOf(req), parse(createInvitationSchema, req.body));
  res.status(201).json({ invitation, token, inviteUrl: `${env.WEB_ORIGIN}/invite/${token}` });
});

// The invitee must be signed in with the invited email; accepting makes that workspace active.
invitationsRouter.post("/:token/accept", requireAuth, async (req, res) => {
  const session = sessionOf(req);
  const token = parse(invitationTokenSchema, req.params.token);
  const user = await getUser(session.userId);
  if (!user) throw notFound("User not found");
  const { workspace, role } = await acceptInvitation(user, token);
  await setSessionCookie(res, { ...session, workspaceId: workspace.id });
  res.json({ workspace: { ...workspace, role } });
});
