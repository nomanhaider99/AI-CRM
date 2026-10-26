import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./env";
import { errorHandler, notFoundHandler } from "./middleware/errors";
import { originCheck } from "./middleware/security";
import { authRouter } from "./routes/auth";
import { invitationsRouter } from "./routes/invitations";
import { membersRouter } from "./routes/members";
import { workspacesRouter } from "./routes/workspaces";

export interface AppOptions {
  /** Login/signup attempts per IP per 15 minutes. */
  authRateLimit?: number;
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  app.disable("x-powered-by");
  if (env.TRUST_PROXY) app.set("trust proxy", 1);

  app.use(helmet());
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  app.use(originCheck(env.WEB_ORIGIN));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.use("/api/auth", authRouter({ rateLimit: options.authRateLimit ?? env.AUTH_RATE_LIMIT }));
  app.use("/api/workspaces", workspacesRouter);
  app.use("/api/members", membersRouter);
  app.use("/api/invitations", invitationsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
