import { createInvoiceSchema, idSchema, listInvoicesQuerySchema, updateInvoiceSchema } from "@crm/shared";
import { Router } from "express";
import { parse } from "../lib/validate";
import { authorize, tenantOf } from "../middleware/auth";
import { createInvoice, deleteInvoice, getInvoice, listInvoices, markInvoicePaid, updateInvoice } from "../services/invoices";

// Middleware checks the role; the services narrow sellers to invoices on their own deals.
export const invoicesRouter = Router();

invoicesRouter.get("/", ...authorize("invoices:read"), async (req, res) => {
  res.json(await listInvoices(tenantOf(req), parse(listInvoicesQuerySchema, req.query)));
});

// Totals and the number (INV-0001, per workspace) are always set by the server.
invoicesRouter.post("/", ...authorize("invoices:write"), async (req, res) => {
  res.status(201).json({ invoice: await createInvoice(tenantOf(req), parse(createInvoiceSchema, req.body)) });
});

invoicesRouter.get("/:id", ...authorize("invoices:read"), async (req, res) => {
  res.json({ invoice: await getInvoice(tenantOf(req), parse(idSchema, req.params.id)) });
});

invoicesRouter.patch("/:id", ...authorize("invoices:write"), async (req, res) => {
  const invoiceId = parse(idSchema, req.params.id);
  res.json({ invoice: await updateInvoice(tenantOf(req), invoiceId, parse(updateInvoiceSchema, req.body)) });
});

invoicesRouter.post("/:id/pay", ...authorize("invoices:write"), async (req, res) => {
  res.json({ invoice: await markInvoicePaid(tenantOf(req), parse(idSchema, req.params.id)) });
});

invoicesRouter.delete("/:id", ...authorize("invoices:delete"), async (req, res) => {
  await deleteInvoice(tenantOf(req), parse(idSchema, req.params.id));
  res.status(204).end();
});
