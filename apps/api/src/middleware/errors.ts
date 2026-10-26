import type { ErrorRequestHandler, RequestHandler } from "express";
import { HttpError } from "../lib/http-error";

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: "Not found" });
};

function pgCode(err: unknown): string | undefined {
  const cause = err instanceof Error && err.cause ? err.cause : err;
  return typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string"
    ? cause.code
    : undefined;
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
    return;
  }
  // body-parser errors (malformed JSON, too large) carry a status
  if (typeof err === "object" && err !== null && "status" in err && typeof err.status === "number" && err.status < 500) {
    res.status(err.status).json({ error: "Invalid request body" });
    return;
  }
  const code = pgCode(err);
  if (code === "23505") {
    res.status(409).json({ error: "Already exists" });
    return;
  }
  // 42501: an RLS WITH CHECK rejected a write outside the caller's workspace
  if (code === "42501") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
};
