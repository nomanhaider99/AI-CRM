import { describe, expect, it } from "vitest";
import { centsToDecimal, createInvoiceSchema, formatInvoiceNumber, invoiceTotals, updateInvoiceSchema } from "./index";

const clientId = "6f1c7c1e-2b9a-4f5e-9c1a-1a2b3c4d5e6f";

describe("invoice totals", () => {
  it("sums qty × unit price per line", () => {
    const t = invoiceTotals([
      { qty: 3, unitPrice: 50 },
      { qty: 1.5, unitPrice: 19.99 },
    ]);
    expect(t.lines).toEqual([150, 29.99]);
    expect(t.total).toBe(179.99);
    expect(t.totalCents).toBe(17999n);
  });

  it("avoids floating point drift", () => {
    // 0.1 + 0.2 in floats is 0.30000000000000004
    expect(invoiceTotals([{ qty: 1, unitPrice: 0.1 }, { qty: 1, unitPrice: 0.2 }]).total).toBe(0.3);
    // 3 × 33.33 = 99.99 exactly, 0.07 × 0.07 = 0.0049 rounds to 0.00
    expect(invoiceTotals([{ qty: 3, unitPrice: 33.33 }, { qty: 0.07, unitPrice: 0.07 }]).total).toBe(99.99);
  });

  it("rounds each line half up to the cent", () => {
    // 0.5 × 0.01 = 0.005 -> 0.01; 0.25 × 0.1 = 0.025 -> 0.03
    expect(invoiceTotals([{ qty: 0.5, unitPrice: 0.01 }]).lines).toEqual([0.01]);
    expect(invoiceTotals([{ qty: 0.25, unitPrice: 0.1 }]).lines).toEqual([0.03]);
  });

  it("is zero for no lines and flags totals too large for numeric(12,2)", () => {
    expect(invoiceTotals([]).total).toBe(0);
    expect(invoiceTotals([{ qty: 1_000_000, unitPrice: 9_999_999 }]).withinLimit).toBe(false);
  });

  it("formats decimals and invoice numbers", () => {
    expect(centsToDecimal(5n)).toBe("0.05");
    expect(centsToDecimal(123450n)).toBe("1234.50");
    expect(formatInvoiceNumber(1)).toBe("INV-0001");
    expect(formatInvoiceNumber(12345)).toBe("INV-12345");
  });
});

describe("invoice schemas", () => {
  const item = { description: "Logo design", qty: 3, unitPrice: 50 };

  it("creates drafts by default and rejects paid on create", () => {
    expect(createInvoiceSchema.parse({ clientId, issueDate: "2026-10-01", items: [item] }).status).toBe("draft");
    expect(createInvoiceSchema.safeParse({ clientId, issueDate: "2026-10-01", items: [item], status: "paid" }).success).toBe(false);
  });

  it("rejects bad items: empty description, zero qty, 3-decimal qty, negative price", () => {
    for (const bad of [
      { ...item, description: " " },
      { ...item, qty: 0 },
      { ...item, qty: 1.005 },
      { ...item, unitPrice: -1 },
    ]) {
      expect(createInvoiceSchema.safeParse({ clientId, issueDate: "2026-10-01", items: [bad] }).success).toBe(false);
    }
  });

  it("rejects a total that would overflow", () => {
    const huge = { description: "Big", qty: 1_000_000, unitPrice: 9_999_999 };
    expect(createInvoiceSchema.safeParse({ clientId, issueDate: "2026-10-01", items: [huge] }).success).toBe(false);
  });

  it("requires a field on update and checks dates when both are sent", () => {
    expect(updateInvoiceSchema.safeParse({}).success).toBe(false);
    expect(updateInvoiceSchema.safeParse({ dueDate: null }).success).toBe(true);
    expect(updateInvoiceSchema.safeParse({ issueDate: "2026-10-02", dueDate: "2026-10-01" }).success).toBe(false);
  });
});
