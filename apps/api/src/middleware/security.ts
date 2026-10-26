import type { RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { forbidden } from "../lib/http-error";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defense in depth on top of SameSite=Lax cookies: browsers send Origin on cross-origin
 * writes, so any write whose Origin is not the web app is rejected. Non-browser clients send none.
 */
export function originCheck(allowedOrigin: string): RequestHandler {
  return (req, _res, next) => {
    const origin = req.get("origin");
    if (!SAFE_METHODS.has(req.method) && origin !== undefined && origin !== allowedOrigin) {
      throw forbidden("Cross-origin request rejected");
    }
    next();
  };
}

export const authRateLimit = (limit: number) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many attempts, try again later" },
  });
