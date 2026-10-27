import { describe, expect, it } from "vitest";
import { canEditInvoice, displayStatus } from "./invoices";

describe("displayStatus", () => {
  const today = "2026-10-27";
  it("marks sent invoices past due as overdue", () => {
    expect(displayStatus({ status: "sent", dueDate: "2026-10-26" }, today)).toBe("overdue");
    expect(displayStatus({ status: "sent", dueDate: today }, today)).toBe("sent");
    expect(displayStatus({ status: "sent", dueDate: null }, today)).toBe("sent");
  });
  it("never marks drafts or paid invoices overdue", () => {
    expect(displayStatus({ status: "draft", dueDate: "2020-01-01" }, today)).toBe("draft");
    expect(displayStatus({ status: "paid", dueDate: "2020-01-01" }, today)).toBe("paid");
  });
});

describe("canEditInvoice", () => {
  it("lets managers edit any unpaid invoice and sellers only their deals' invoices", () => {
    const open = { status: "sent" as const, dealOwnerId: "u2" };
    expect(canEditInvoice("admin", "u1", open)).toBe(true);
    expect(canEditInvoice("pm", "u1", open)).toBe(true);
    expect(canEditInvoice("seller", "u1", open)).toBe(false);
    expect(canEditInvoice("seller", "u2", open)).toBe(true);
    expect(canEditInvoice("seller", "u1", { ...open, dealOwnerId: null })).toBe(false);
  });
  it("locks paid invoices", () => {
    expect(canEditInvoice("admin", "u1", { status: "paid", dealOwnerId: "u1" })).toBe(false);
  });
});
