import { describe, expect, it } from "vitest";
import { createClientSchema, createDealSchema, moveDealSchema, updateDealSchema, createInvoiceSchema, listClientsQuerySchema, updateClientSchema, moneySchema, signupSchema, updateMemberSchema } from "./index";

const clientId = "6f1c7c1e-2b9a-4f5e-9c1a-1a2b3c4d5e6f";
const item = { description: "Logo design", qty: 3, unitPrice: 50 };

describe("shared schemas", () => {
  it("normalizes email on signup", () => {
    const parsed = signupSchema.parse({ name: "Ana", email: "  Ana@Example.COM ", password: "longenough" });
    expect(parsed.email).toBe("ana@example.com");
  });

  it("rejects short passwords", () => {
    expect(signupSchema.safeParse({ name: "Ana", email: "a@b.co", password: "short" }).success).toBe(false);
  });

  it("defaults client status to lead", () => {
    expect(createClientSchema.parse({ name: "John" }).status).toBe("lead");
  });

  it("does not inject defaults into a client update", () => {
    expect(updateClientSchema.parse({ name: "John" })).toEqual({ name: "John" });
  });

  it("rejects an empty client update", () => {
    expect(updateClientSchema.safeParse({}).success).toBe(false);
  });

  it("coerces and bounds client list pagination", () => {
    expect(listClientsQuerySchema.parse({ limit: "10", offset: "20" })).toEqual({ limit: 10, offset: 20 });
    expect(listClientsQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
  });

  it("rejects unknown roles", () => {
    expect(updateMemberSchema.safeParse({ role: "owner" }).success).toBe(false);
  });

  it("allows at most 2 decimals for money", () => {
    expect(moneySchema.safeParse(49.99).success).toBe(true);
    expect(moneySchema.safeParse(0.1 + 0.2).success).toBe(true);
    expect(moneySchema.safeParse(1.005).success).toBe(false);
    expect(moneySchema.safeParse(-1).success).toBe(false);
  });

  it("requires at least one invoice item", () => {
    expect(createInvoiceSchema.safeParse({ clientId, issueDate: "2026-10-01", items: [] }).success).toBe(false);
  });

  it("rejects a due date before the issue date", () => {
    const res = createInvoiceSchema.safeParse({ clientId, issueDate: "2026-10-01", dueDate: "2026-09-01", items: [item] });
    expect(res.success).toBe(false);
  });

  it("defaults invoice currency to USD", () => {
    expect(createInvoiceSchema.parse({ clientId, issueDate: "2026-10-01", items: [item] }).currency).toBe("USD");
  });

  it("leaves a new deal's owner unset unless given, and accepts null for unassigned", () => {
    const base = { clientId, stageId: clientId, title: "Logo" };
    expect(createDealSchema.parse(base)).toEqual({ ...base, value: 0, currency: "USD" });
    expect(createDealSchema.parse({ ...base, ownerId: null }).ownerId).toBeNull();
  });

  it("keeps stage and position out of deal updates", () => {
    expect(updateDealSchema.safeParse({ stageId: clientId, position: 0 }).success).toBe(false);
    expect(updateDealSchema.parse({ value: 10, position: 3 })).toEqual({ value: 10 });
  });

  it("requires a whole, non-negative position to move a deal", () => {
    expect(moveDealSchema.safeParse({ stageId: clientId, position: 0 }).success).toBe(true);
    for (const position of [-1, 1.5, "2", undefined]) {
      expect(moveDealSchema.safeParse({ stageId: clientId, position }).success).toBe(false);
    }
  });
});
