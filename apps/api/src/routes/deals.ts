import { createDealSchema, idSchema, listDealsQuerySchema, moveDealSchema, updateDealSchema } from "@crm/shared";
import { Router } from "express";
import { parse } from "../lib/validate";
import { authorize, tenantOf } from "../middleware/auth";
import { createDeal, deleteDeal, getDeal, listDeals, listStages, moveDeal, updateDeal } from "../services/deals";

export const stagesRouter = Router();

stagesRouter.get("/", ...authorize("deals:read"), async (req, res) => {
  res.json({ stages: await listStages(tenantOf(req)) });
});

// Middleware checks the role; the services narrow sellers to their own (and, for reads, unassigned) deals
// and require deals:reassign for owner changes.
export const dealsRouter = Router();

dealsRouter.get("/", ...authorize("deals:read"), async (req, res) => {
  res.json(await listDeals(tenantOf(req), parse(listDealsQuerySchema, req.query)));
});

dealsRouter.post("/", ...authorize("deals:write"), async (req, res) => {
  res.status(201).json({ deal: await createDeal(tenantOf(req), parse(createDealSchema, req.body)) });
});

dealsRouter.get("/:id", ...authorize("deals:read"), async (req, res) => {
  res.json({ deal: await getDeal(tenantOf(req), parse(idSchema, req.params.id)) });
});

dealsRouter.patch("/:id", ...authorize("deals:write"), async (req, res) => {
  const dealId = parse(idSchema, req.params.id);
  res.json({ deal: await updateDeal(tenantOf(req), dealId, parse(updateDealSchema, req.body)) });
});

// Kanban drag and drop: new stage and 0-based index in it; both columns are renumbered.
dealsRouter.post("/:id/move", ...authorize("deals:write"), async (req, res) => {
  const dealId = parse(idSchema, req.params.id);
  res.json({ deal: await moveDeal(tenantOf(req), dealId, parse(moveDealSchema, req.body)) });
});

dealsRouter.delete("/:id", ...authorize("deals:write"), async (req, res) => {
  await deleteDeal(tenantOf(req), parse(idSchema, req.params.id));
  res.status(204).end();
});
