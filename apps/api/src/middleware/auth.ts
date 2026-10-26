import type { Permission } from "@crm/shared";
import { can } from "@crm/shared";
import { and, eq } from "drizzle-orm";
import type { Request, RequestHandler } from "express";
import { SESSION_COOKIE, verifySession } from "../auth/session";
import { db } from "../db/client";
import { withDbContext } from "../db/context";
import { memberships, users } from "../db/schema";
import { forbidden, HttpError, unauthorized } from "../lib/http-error";

/** Verifies the session cookie and rejects tokens revoked by logout (session_version mismatch). */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token: unknown = req.cookies[SESSION_COOKIE];
  if (typeof token !== "string" || token === "") throw unauthorized();

  const session = await verifySession(token);
  if (!session) throw unauthorized("Invalid or expired session");

  const [user] = await db
    .select({ sessionVersion: users.sessionVersion })
    .from(users)
    .where(eq(users.id, session.userId));
  if (!user || user.sessionVersion !== session.sessionVersion) throw unauthorized("Invalid or expired session");

  req.session = session;
  next();
};

/**
 * Resolves the active workspace from the signed session (never from the request) and loads the
 * caller's role from memberships, so removals and role changes apply on the next request.
 */
export const requireWorkspace: RequestHandler = async (req, _res, next) => {
  const session = req.session;
  if (!session) throw unauthorized();
  if (!session.workspaceId) throw forbidden("No workspace selected");

  const { userId, workspaceId } = session;
  const [membership] = await withDbContext({ userId, workspaceId }, (tx) =>
    tx
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId))),
  );
  if (!membership) throw forbidden("Not a member of this workspace");

  req.tenant = { userId, workspaceId, role: membership.role };
  next();
};

export function requirePermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    if (!req.tenant) throw unauthorized();
    if (!can(req.tenant.role, permission)) throw forbidden(`Your role cannot perform ${permission}`);
    next();
  };
}

/** Standard chain for workspace routes: authenticated, member of the active workspace, role allows it. */
export const authorize = (permission: Permission): RequestHandler[] => [
  requireAuth,
  requireWorkspace,
  requirePermission(permission),
];

export function sessionOf(req: Request) {
  if (!req.session) throw new HttpError(500, "requireAuth did not run");
  return req.session;
}

export function tenantOf(req: Request) {
  if (!req.tenant) throw new HttpError(500, "requireWorkspace did not run");
  return req.tenant;
}
