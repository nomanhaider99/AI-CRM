import { idSchema, updateMemberSchema } from "@crm/shared";
import { Router } from "express";
import { parse } from "../lib/validate";
import { authorize, tenantOf } from "../middleware/auth";
import { listMembers, removeMember, updateMemberRole } from "../services/members";

export const membersRouter = Router();

membersRouter.get("/", ...authorize("members:read"), async (req, res) => {
  res.json({ members: await listMembers(tenantOf(req)) });
});

// :id is the member's user id (memberships are keyed by workspace + user).
membersRouter.patch("/:id", ...authorize("workspace:manage"), async (req, res) => {
  const memberId = parse(idSchema, req.params.id);
  const { role } = parse(updateMemberSchema, req.body);
  res.json({ member: await updateMemberRole(tenantOf(req), memberId, role) });
});

membersRouter.delete("/:id", ...authorize("workspace:manage"), async (req, res) => {
  await removeMember(tenantOf(req), parse(idSchema, req.params.id));
  res.status(204).end();
});
