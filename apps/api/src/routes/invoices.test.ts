import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sqlClient } from "../db/client";
import { app, cleanup, createTeam, ownerSql } from "../test/helpers";
import type { Team, TestUser } from "../test/helpers";

interface Invoice {
  id: string;
  number: string;
  status: "draft" | "sent" | "paid";
  clientId: string;
  clientName: string;
  dealId: string | null;
  dealTitle: string | null;
  dealOwnerId: string | null;
  issueDate: string;
  dueDate: string | null;
  total: number;
  currency: string;
  paidAt: string | null;
  items: { id: string; description: string; qty: number; unitPrice: number; amount: number }[];
}

const ITEMS = [
  { description: "Logo design", qty: 3, unitPrice: 50 },
  { description: "Brand guide", qty: 1.5, unitPrice: 19.99 },
];

let team: Team;
let other: Team;
let clientId: string;
let leadStage: string;
// Deals on clientId, one per owner, plus an unassigned one.
let deals: { admin: string; pm: string; seller: string; unassigned: string };

async function newClient(user: TestUser, name = "Invoice Client") {
  const res = await user.agent.post("/api/clients").send({ name }).expect(201);
  return res.body.client.id as string;
}

async function newDeal(user: TestUser, body: Record<string, unknown> = {}) {
  const res = await user.agent.post("/api/deals").send({ title: "Deal", clientId, stageId: leadStage, ...body }).expect(201);
  return res.body.deal.id as string;
}

async function newInvoice(user: TestUser, body: Record<string, unknown> = {}) {
  const res = await user.agent
    .post("/api/invoices")
    .send({ clientId, dealId: deals.seller, issueDate: "2026-10-01", items: ITEMS, ...body })
    .expect(201);
  return res.body.invoice as Invoice;
}

async function auditActions(entityId: string) {
  const rows = await ownerSql<{ action: string }[]>`select action from audit_log where entity_id = ${entityId} order by created_at`;
  return rows.map((r) => r.action);
}

async function invoiceEvents(client: string) {
  return ownerSql<{ title: string; amount: string; type: string }[]>`
    select title, amount, type from client_events where client_id = ${client} and type = 'invoice' order by created_at`;
}

beforeAll(async () => {
  team = await createTeam("invoices");
  other = await createTeam("invoices-other");
  const stages = await team.admin.agent.get("/api/stages").expect(200);
  leadStage = stages.body.stages[0].id;
  clientId = await newClient(team.admin);
  deals = {
    admin: await newDeal(team.admin),
    pm: await newDeal(team.pm),
    seller: await newDeal(team.seller),
    unassigned: await newDeal(team.admin, { ownerId: null }),
  };
});
afterAll(async () => {
  await cleanup();
  await Promise.all([ownerSql.end(), sqlClient.end()]);
});

describe("auth", () => {
  it("requires a session", async () => {
    await request(app).get("/api/invoices").expect(401);
    await request(app).post("/api/invoices").send({}).expect(401);
  });
});

describe("numbering", () => {
  it("numbers invoices sequentially per workspace, starting at INV-0001", async () => {
    const t = await createTeam("invoices-seq");
    const c = (await t.admin.agent.post("/api/clients").send({ name: "Seq" }).expect(201)).body.client.id;
    const body = { clientId: c, issueDate: "2026-10-01", items: ITEMS };
    const first = await t.admin.agent.post("/api/invoices").send(body).expect(201);
    const second = await t.pm.agent.post("/api/invoices").send(body).expect(201);
    expect([first.body.invoice.number, second.body.invoice.number]).toEqual(["INV-0001", "INV-0002"]);

    // A different workspace has its own sequence.
    const oc = await newClient(other.admin, "Other seq");
    const theirs = await other.admin.agent.post("/api/invoices").send({ ...body, clientId: oc }).expect(201);
    expect(theirs.body.invoice.number).toBe("INV-0001");
  });

  it("gives concurrent creates distinct, consecutive numbers", async () => {
    const t = await createTeam("invoices-race");
    const c = (await t.admin.agent.post("/api/clients").send({ name: "Race" }).expect(201)).body.client.id;
    const body = { clientId: c, issueDate: "2026-10-01", items: ITEMS };
    const users = [t.admin, t.pm, t.admin, t.pm, t.admin, t.pm, t.admin, t.pm, t.admin, t.pm];
    const results = await Promise.all(users.map((u) => u.agent.post("/api/invoices").send(body)));
    expect(results.map((r) => r.status)).toEqual(users.map(() => 201));
    const numbers = results.map((r) => r.body.invoice.number as string).sort();
    expect(numbers).toEqual(Array.from({ length: 10 }, (_, i) => `INV-${String(i + 1).padStart(4, "0")}`));
  });
});

describe("totals", () => {
  it("computes line amounts and the total on the server, ignoring any sent total", async () => {
    const invoice = await newInvoice(team.admin, { total: 1, items: ITEMS.map((i) => ({ ...i, amount: 999 })) });
    expect(invoice.items.map((i) => i.amount)).toEqual([150, 29.99]);
    expect(invoice.total).toBe(179.99);
    expect(invoice.items.map((i) => i.description)).toEqual(["Logo design", "Brand guide"]);
    const [row] = await ownerSql<{ total: string }[]>`select total from invoices where id = ${invoice.id}`;
    expect(row!.total).toBe("179.99");
  });

  it("is exact for amounts that drift in floating point", async () => {
    const invoice = await newInvoice(team.admin, {
      items: [
        { description: "A", qty: 1, unitPrice: 0.1 },
        { description: "B", qty: 1, unitPrice: 0.2 },
        { description: "C", qty: 3, unitPrice: 33.33 },
      ],
    });
    expect(invoice.total).toBe(100.29);
  });

  it("recomputes the total when items are replaced", async () => {
    const invoice = await newInvoice(team.admin);
    const res = await team.admin.agent
      .patch(`/api/invoices/${invoice.id}`)
      .send({ items: [{ description: "Website", qty: 2, unitPrice: 1200.5 }] })
      .expect(200);
    expect(res.body.invoice.total).toBe(2401);
    expect(res.body.invoice.items).toHaveLength(1);
    const [{ n } = { n: 0 }] = await ownerSql<{ n: number }[]>`select count(*)::int as n from invoice_items where invoice_id = ${invoice.id}`;
    expect(n).toBe(1);
  });
});

describe("validation", () => {
  const base = () => ({ clientId, dealId: deals.admin, issueDate: "2026-10-01", items: ITEMS });

  it("rejects invalid create bodies with field errors", async () => {
    const { agent } = team.admin;
    const cases: Record<string, unknown>[] = [
      { ...base(), items: [] },
      { ...base(), items: [{ description: "", qty: 1, unitPrice: 1 }] },
      { ...base(), items: [{ description: "X", qty: 0, unitPrice: 1 }] },
      { ...base(), items: [{ description: "X", qty: 1, unitPrice: 1.005 }] },
      { ...base(), items: [{ description: "X", qty: 1, unitPrice: -5 }] },
      { ...base(), issueDate: "01/10/2026" },
      { ...base(), dueDate: "2026-09-30" },
      { ...base(), status: "paid" },
      { ...base(), currency: "dollars" },
      { ...base(), clientId: "not-a-uuid" },
    ];
    for (const body of cases) {
      const res = await agent.post("/api/invoices").send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.details.fieldErrors).toBeTypeOf("object");
    }
  });

  it("rejects a deal of another client and unknown clients", async () => {
    const otherClient = await newClient(team.admin, "Someone else");
    await team.admin.agent.post("/api/invoices").send({ ...base(), clientId: otherClient }).expect(400);
    await team.admin.agent.post("/api/invoices").send({ ...base(), clientId: crypto.randomUUID(), dealId: undefined }).expect(400);
  });

  it("checks a sent due date against the stored issue date", async () => {
    const invoice = await newInvoice(team.admin, { dealId: deals.admin, issueDate: "2026-10-10" });
    const res = await team.admin.agent.patch(`/api/invoices/${invoice.id}`).send({ dueDate: "2026-10-01" }).expect(400);
    expect(res.body.details.fieldErrors.dueDate).toBeDefined();
    await team.admin.agent.patch(`/api/invoices/${invoice.id}`).send({}).expect(400);
    const ok = await team.admin.agent.patch(`/api/invoices/${invoice.id}`).send({ dueDate: "2026-10-31", status: "sent" }).expect(200);
    expect(ok.body.invoice).toMatchObject({ dueDate: "2026-10-31", status: "sent", issueDate: "2026-10-10" });
  });
});

describe("timeline and audit", () => {
  it("adds an invoice event to the client timeline on create and on paid, and audits each change", async () => {
    const c = await newClient(team.admin, "Timeline Client");
    const invoice = await newInvoice(team.admin, { clientId: c, dealId: undefined });
    await team.admin.agent.patch(`/api/invoices/${invoice.id}`).send({ status: "sent" }).expect(200);
    const paid = await team.admin.agent.post(`/api/invoices/${invoice.id}/pay`).expect(200);
    expect(paid.body.invoice.status).toBe("paid");
    expect(paid.body.invoice.paidAt).toBeTypeOf("string");

    const events = await invoiceEvents(c);
    expect(events).toEqual([
      { type: "invoice", title: `Invoice ${invoice.number} created`, amount: "179.99" },
      { type: "invoice", title: `Invoice ${invoice.number} paid`, amount: "179.99" },
    ]);
    // Visible through the API timeline too.
    const timeline = await team.seller.agent.get(`/api/clients/${c}/events`).expect(200);
    expect(timeline.body.events.map((e: { title: string }) => e.title)).toContain(`Invoice ${invoice.number} paid`);

    await team.admin.agent.delete(`/api/invoices/${invoice.id}`).expect(204);
    expect(await auditActions(invoice.id)).toEqual(["invoice.create", "invoice.update", "invoice.pay", "invoice.delete"]);
  });

  it("a status PATCH to paid behaves like /pay", async () => {
    const c = await newClient(team.admin, "Patch paid");
    const invoice = await newInvoice(team.pm, { clientId: c, dealId: undefined });
    const res = await team.pm.agent.patch(`/api/invoices/${invoice.id}`).send({ status: "paid" }).expect(200);
    expect(res.body.invoice.status).toBe("paid");
    expect((await invoiceEvents(c)).map((e) => e.title)).toEqual([`Invoice ${invoice.number} created`, `Invoice ${invoice.number} paid`]);
    expect(await auditActions(invoice.id)).toEqual(["invoice.create", "invoice.update", "invoice.pay"]);
  });

  it("locks paid invoices and refuses paying twice", async () => {
    const invoice = await newInvoice(team.admin, { dealId: deals.admin });
    await team.admin.agent.post(`/api/invoices/${invoice.id}/pay`).expect(200);
    await team.admin.agent.post(`/api/invoices/${invoice.id}/pay`).expect(409);
    await team.admin.agent.patch(`/api/invoices/${invoice.id}`).send({ status: "draft" }).expect(409);
    await team.admin.agent.patch(`/api/invoices/${invoice.id}`).send({ items: ITEMS }).expect(409);
  });

  it("two concurrent pay requests produce one paid event", async () => {
    const c = await newClient(team.admin, "Double pay");
    const invoice = await newInvoice(team.admin, { clientId: c, dealId: undefined });
    const [a, b] = await Promise.all([
      team.admin.agent.post(`/api/invoices/${invoice.id}/pay`),
      team.pm.agent.post(`/api/invoices/${invoice.id}/pay`),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await invoiceEvents(c)).filter((e) => e.title.endsWith("paid"))).toHaveLength(1);
  });
});

describe("role permissions", () => {
  it("admin and PM manage any invoice, with or without a deal", async () => {
    for (const user of [team.admin, team.pm]) {
      for (const dealId of [deals.seller, deals.unassigned, undefined]) {
        const invoice = await newInvoice(user, { dealId });
        await user.agent.patch(`/api/invoices/${invoice.id}`).send({ status: "sent" }).expect(200);
      }
    }
    const sellers = await newInvoice(team.seller);
    await team.pm.agent.patch(`/api/invoices/${sellers.id}`).send({ dueDate: "2026-12-01" }).expect(200);
    await team.pm.agent.post(`/api/invoices/${sellers.id}/pay`).expect(200);
  });

  it("seller creates, edits and pays invoices on their own deals", async () => {
    const invoice = await newInvoice(team.seller);
    expect(invoice).toMatchObject({ dealId: deals.seller, dealOwnerId: team.seller.id, dealTitle: "Deal" });
    await team.seller.agent.patch(`/api/invoices/${invoice.id}`).send({ items: [ITEMS[0]] }).expect(200);
    await team.seller.agent.post(`/api/invoices/${invoice.id}/pay`).expect(200);
  });

  it("seller cannot invoice without a deal, on someone else's deal, or on an unassigned deal", async () => {
    const { agent } = team.seller;
    const body = { clientId, issueDate: "2026-10-01", items: ITEMS };
    await agent.post("/api/invoices").send(body).expect(403);
    await agent.post("/api/invoices").send({ ...body, dealId: deals.pm }).expect(400);
    await agent.post("/api/invoices").send({ ...body, dealId: deals.unassigned }).expect(403);
  });

  it("seller can read but not change invoices that are not on their deals", async () => {
    const managers = await newInvoice(team.pm, { dealId: deals.pm });
    const { agent } = team.seller;
    const read = await agent.get(`/api/invoices/${managers.id}`).expect(200);
    // The title of a deal the seller cannot see is withheld.
    expect(read.body.invoice).toMatchObject({ dealId: deals.pm, dealTitle: null });
    await agent.patch(`/api/invoices/${managers.id}`).send({ status: "sent" }).expect(403);
    await agent.post(`/api/invoices/${managers.id}/pay`).expect(403);

    const own = await newInvoice(team.seller);
    await agent.patch(`/api/invoices/${own.id}`).send({ dealId: deals.unassigned }).expect(403);
    await agent.patch(`/api/invoices/${own.id}`).send({ dealId: null }).expect(403);
  });

  it("only admin deletes invoices", async () => {
    const invoice = await newInvoice(team.seller);
    await team.seller.agent.delete(`/api/invoices/${invoice.id}`).expect(403);
    await team.pm.agent.delete(`/api/invoices/${invoice.id}`).expect(403);
    await team.admin.agent.delete(`/api/invoices/${invoice.id}`).expect(204);
    await team.admin.agent.get(`/api/invoices/${invoice.id}`).expect(404);
    const [{ n } = { n: -1 }] = await ownerSql<{ n: number }[]>`select count(*)::int as n from invoice_items where invoice_id = ${invoice.id}`;
    expect(n).toBe(0);
  });
});

describe("list", () => {
  let listClient: string;
  let created: Invoice[];

  beforeAll(async () => {
    listClient = await newClient(team.admin, "Zephyr Listing Co");
    created = [];
    for (let i = 0; i < 3; i++) created.push(await newInvoice(team.admin, { clientId: listClient, dealId: undefined }));
    await team.admin.agent.patch(`/api/invoices/${created[0]!.id}`).send({ status: "sent" }).expect(200);
    await team.admin.agent.post(`/api/invoices/${created[1]!.id}/pay`).expect(200);
  });

  it("filters by client and status, newest first", async () => {
    const all = await team.seller.agent.get("/api/invoices").query({ clientId: listClient }).expect(200);
    expect(all.body.invoices.map((i: Invoice) => i.id)).toEqual(created.map((i) => i.id).reverse());
    expect(all.body.total).toBe(3);
    expect(all.body.invoices[0]).not.toHaveProperty("items");

    const paid = await team.admin.agent.get("/api/invoices").query({ clientId: listClient, status: "paid" }).expect(200);
    expect(paid.body.invoices.map((i: Invoice) => i.id)).toEqual([created[1]!.id]);
    await team.admin.agent.get("/api/invoices").query({ status: "overdue" }).expect(400);
  });

  it("searches by number and client name", async () => {
    const byName = await team.admin.agent.get("/api/invoices").query({ search: "zephyr list" }).expect(200);
    expect(byName.body.total).toBe(3);
    const byNumber = await team.admin.agent.get("/api/invoices").query({ search: created[2]!.number }).expect(200);
    expect(byNumber.body.invoices.map((i: Invoice) => i.id)).toEqual([created[2]!.id]);
    const wildcard = await team.admin.agent.get("/api/invoices").query({ search: "%" }).expect(200);
    expect(wildcard.body.total).toBe(0);
  });

  it("paginates with a total count", async () => {
    const page = await team.admin.agent.get("/api/invoices").query({ clientId: listClient, limit: 2, offset: 2 }).expect(200);
    expect(page.body).toMatchObject({ total: 3, limit: 2, offset: 2 });
    expect(page.body.invoices.map((i: Invoice) => i.id)).toEqual([created[0]!.id]);
    await team.admin.agent.get("/api/invoices").query({ limit: 500 }).expect(400);
  });
});

describe("workspace isolation", () => {
  let invoice: Invoice;
  beforeAll(async () => {
    invoice = await newInvoice(team.admin, { dealId: deals.admin });
  });

  it("another workspace cannot read, change, pay or delete an invoice", async () => {
    const { agent } = other.admin;
    await agent.get(`/api/invoices/${invoice.id}`).expect(404);
    await agent.patch(`/api/invoices/${invoice.id}`).send({ status: "sent" }).expect(404);
    await agent.post(`/api/invoices/${invoice.id}/pay`).expect(404);
    await agent.delete(`/api/invoices/${invoice.id}`).expect(404);
    const list = await agent.get("/api/invoices").expect(200);
    expect(list.body.invoices.map((i: Invoice) => i.id)).not.toContain(invoice.id);
    const [row] = await ownerSql<{ status: string }[]>`select status from invoices where id = ${invoice.id}`;
    expect(row!.status).toBe("draft");
  });

  it("another workspace cannot invoice our client or attach our deal", async () => {
    const { agent } = other.admin;
    await agent.post("/api/invoices").send({ clientId, issueDate: "2026-10-01", items: ITEMS }).expect(400);
    const theirClient = await newClient(other.admin, "Theirs");
    await agent.post("/api/invoices").send({ clientId: theirClient, dealId: deals.admin, issueDate: "2026-10-01", items: ITEMS }).expect(400);
    const theirs = (await agent.post("/api/invoices").send({ clientId: theirClient, issueDate: "2026-10-01", items: ITEMS }).expect(201)).body
      .invoice as Invoice;
    await agent.patch(`/api/invoices/${theirs.id}`).send({ dealId: deals.admin }).expect(400);
  });

  it("RLS hides invoices and items outside the workspace context", async () => {
    const rows = await sqlClient.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${other.workspaceId}, true)`;
      const inv = await tx`select id from invoices where id = ${invoice.id}`;
      const items = await tx`select id from invoice_items where invoice_id = ${invoice.id}`;
      return inv.length + items.length;
    });
    expect(rows).toBe(0);
  });
});
