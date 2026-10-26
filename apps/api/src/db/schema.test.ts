import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "./schema";

describe("schema definition", () => {
  it("every tenant table has a non-null workspace_id", () => {
    for (const table of schema.tenantTables) {
      const config = getTableConfig(table);
      const col = config.columns.find((c) => c.name === "workspace_id");
      expect(col, `${config.name} is missing workspace_id`).toBeDefined();
      expect(col?.notNull, `${config.name}.workspace_id must be NOT NULL`).toBe(true);
    }
  });
});
