import type { Role } from "@crm/shared";
import type { Session } from "./auth/session";

declare module "express-serve-static-core" {
  interface Request {
    /** Set by requireAuth: a verified, non-revoked session. */
    session?: Session;
    /** Set by requireWorkspace: the active workspace and the caller's current role in it. */
    tenant?: { userId: string; workspaceId: string; role: Role };
  }
}

export {};
