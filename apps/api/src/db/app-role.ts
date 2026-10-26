import type { Sql } from "postgres";

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;

/**
 * Creates or updates the login role the API connects as (taken from APP_DATABASE_URL) and grants it
 * DML only. It is never a superuser, never owns tables, and cannot bypass RLS, so policies always apply.
 * Runs after every migration so new tables get their grants too.
 */
export async function ensureAppRole(owner: Sql, appDatabaseUrl: string): Promise<string> {
  const url = new URL(appDatabaseUrl);
  const role = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const database = decodeURIComponent(url.pathname.slice(1));

  if (!IDENTIFIER.test(role)) throw new Error(`APP_DATABASE_URL user "${role}" must match ${IDENTIFIER}`);
  if (!IDENTIFIER.test(database)) throw new Error(`APP_DATABASE_URL database "${database}" must match ${IDENTIFIER}`);
  if (password.length < 16) throw new Error("APP_DATABASE_URL password must be at least 16 characters");

  const [{ owner_role: ownerRole } = { owner_role: "" }] = await owner<{ owner_role: string }[]>`select current_user as owner_role`;
  if (role === ownerRole) throw new Error("APP_DATABASE_URL must use a different role than DATABASE_URL");

  const exists = await owner`select 1 from pg_roles where rolname = ${role}`;
  if (exists.length === 0) await owner.unsafe(`CREATE ROLE "${role}" LOGIN`);

  await owner.unsafe(
    `ALTER ROLE "${role}" WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${literal(password)}`,
  );
  await owner.unsafe(`GRANT CONNECT ON DATABASE "${database}" TO "${role}"`);
  await owner.unsafe(`GRANT USAGE ON SCHEMA public TO "${role}"`);
  await owner.unsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${role}"`);
  await owner.unsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${role}"`);
  await owner.unsafe(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO "${role}"`);
  return role;
}
