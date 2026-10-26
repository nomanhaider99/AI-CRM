import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import * as schema from "./schema";

// Connects as the app role: RLS policies apply to every query made through this client.
export const sqlClient = postgres(env.APP_DATABASE_URL, { max: 10, onnotice: () => {} });
export const db = drizzle(sqlClient, { schema });
export type Db = typeof db;
