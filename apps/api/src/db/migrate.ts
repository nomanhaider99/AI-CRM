import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { env } from "../env";
import { ensureAppRole } from "./app-role";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

if (!env.DATABASE_URL) throw new Error("DATABASE_URL (owner connection) is required to run migrations");

const client = postgres(env.DATABASE_URL, { max: 1, onnotice: () => {} });
try {
  await migrate(drizzle(client), { migrationsFolder });
  console.log("Migrations applied.");
  const role = await ensureAppRole(client, env.APP_DATABASE_URL);
  console.log(`App role "${role}" ready (no superuser, no BYPASSRLS).`);
} catch (err) {
  console.error("Migration failed:", err);
  process.exitCode = 1;
} finally {
  await client.end();
}
