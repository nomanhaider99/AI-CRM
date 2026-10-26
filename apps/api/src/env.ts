import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// .env lives at the repo root so docker compose and the API share it.
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)), quiet: true });

const envSchema = z.object({
  DATABASE_URL: z.url(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export const env = envSchema.parse(process.env);
