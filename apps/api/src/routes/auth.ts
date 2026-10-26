import { loginSchema, signupSchema } from "@crm/shared";
import { Router } from "express";
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie, verifySession } from "../auth/session";
import { notFound } from "../lib/http-error";
import { parse } from "../lib/validate";
import { requireAuth, sessionOf } from "../middleware/auth";
import { authRateLimit } from "../middleware/security";
import { getUser, listUserWorkspaces, login, revokeSessions, signup } from "../services/auth";

export function authRouter(options: { rateLimit: number }): Router {
  const router = Router();
  const limiter = authRateLimit(options.rateLimit);

  router.post("/signup", limiter, async (req, res) => {
    const user = await signup(parse(signupSchema, req.body));
    await setSessionCookie(res, { userId: user.id, workspaceId: null, sessionVersion: user.sessionVersion });
    res.status(201).json({ user: { id: user.id, email: user.email, name: user.name }, workspace: null });
  });

  router.post("/login", limiter, async (req, res) => {
    const user = await login(parse(loginSchema, req.body));
    const [workspace = null] = await listUserWorkspaces(user.id);
    await setSessionCookie(res, { userId: user.id, workspaceId: workspace?.id ?? null, sessionVersion: user.sessionVersion });
    res.json({ user: { id: user.id, email: user.email, name: user.name }, workspace });
  });

  // Always clears the cookie; a valid token also revokes every session of that user.
  router.post("/logout", async (req, res) => {
    const token: unknown = req.cookies[SESSION_COOKIE];
    const session = typeof token === "string" ? await verifySession(token) : null;
    if (session) await revokeSessions(session.userId);
    clearSessionCookie(res);
    res.status(204).end();
  });

  router.get("/me", requireAuth, async (req, res) => {
    const session = sessionOf(req);
    const user = await getUser(session.userId);
    if (!user) throw notFound("User not found");
    const workspaces = await listUserWorkspaces(session.userId);
    const workspace = workspaces.find((w) => w.id === session.workspaceId) ?? null;
    res.json({ user, workspace, workspaces });
  });

  return router;
}
