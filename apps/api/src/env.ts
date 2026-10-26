import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// .env lives at the repo root so docker compose and the API share it.
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

const envSchema = z.object({
  // Owner connection: migrations and test setup only. The API itself never uses it.
  DATABASE_URL: z.url().optional(),
  // Non-superuser role the API connects as, so RLS applies (created by `pnpm db:migrate`).
  APP_DATABASE_URL: z.url(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.url().default("http://localhost:3000"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(168),
  AUTH_RATE_LIMIT: z.coerce.number().int().positive().default(20), // login/signup attempts per IP per 15 min
  TRUST_PROXY: z.stringbool().default(false),
});

export const env = envSchema.parse(process.env);
