import type { CookieOptions, Response } from "express";
import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import { env } from "../env";

export const SESSION_COOKIE = "crm_session";
export const JWT_ISSUER = "ai-crm-api";
export const JWT_AUDIENCE = "ai-crm-web";

const key = new TextEncoder().encode(env.JWT_SECRET);
const ttlSeconds = Math.round(env.SESSION_TTL_HOURS * 3600);

export interface Session {
  userId: string;
  /** Active workspace. Signed into the token; membership and role are re-read from the DB on every request. */
  workspaceId: string | null;
  sessionVersion: number;
}

const claimsSchema = z.object({
  sub: z.uuid(),
  wid: z.uuid().nullable(),
  sv: z.number().int().nonnegative(),
});

export function signSession(session: Session): Promise<string> {
  return new SignJWT({ wid: session.workspaceId, sv: session.sessionVersion })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(session.userId)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key);
}

/** Returns the session for a valid token, or null if it is malformed, tampered, expired or not HS256. */
export async function verifySession(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      requiredClaims: ["exp", "iat", "sub"],
    });
    const claims = claimsSchema.parse(payload);
    return { userId: claims.sub, workspaceId: claims.wid, sessionVersion: claims.sv };
  } catch {
    return null;
  }
}

const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
};

export async function setSessionCookie(res: Response, session: Session): Promise<void> {
  res.cookie(SESSION_COOKIE, await signSession(session), { ...cookieOptions, maxAge: ttlSeconds * 1000 });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, cookieOptions);
}
