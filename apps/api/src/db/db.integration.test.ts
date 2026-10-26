import { sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { afterAll, describe, expect, it } from "vitest";
import { db, sqlClient } from "./client";
import * as schema from "./schema";

// Needs a running, migrated DB: `docker compose up -d db && pnpm db:migrate`.
describe("migrated database", () => {
  afterAll(() => sqlClient.end());

  it("has the pgvector extension", async () => {
    const rows = await db.execute<{ extname: string }>(sql`select extname from pg_extension where extname = 'vector'`);
    expect(rows.length).toBe(1);
  });

  it("has every table from the schema", async () => {
    const rows = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const actual = new Set(rows.map((r) => r.table_name));
    const expected = [schema.users, schema.workspaces, ...schema.tenantTables].map((t) => getTableConfig(t).name);
    for (const name of expected) expect(actual, `missing table ${name}`).toContain(name);
  });

  it("stores and queries a 1536-dim embedding", async () => {
    const vec = `[${Array.from({ length: schema.EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0)).join(",")}]`;
    const rows = await db.execute<{ distance: number }>(sql`select (${vec}::vector <=> ${vec}::vector) as distance`);
    expect(Number(rows[0]?.distance)).toBe(0);
  });
});
