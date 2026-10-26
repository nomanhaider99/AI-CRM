import {
  createClientEventSchema,
  createClientSchema,
  idSchema,
  listClientsQuerySchema,
  paginationQuerySchema,
  updateClientSchema,
} from "@crm/shared";
import { Router } from "express";
import { parse } from "../lib/validate";
import { authorize, tenantOf } from "../middleware/auth";
import {
  createClient,
  createClientEvent,
  deleteClient,
  getClient,
  listClientEvents,
  listClients,
  updateClient,
} from "../services/clients";

export const clientsRouter = Router();

clientsRouter.get("/", ...authorize("clients:read"), async (req, res) => {
  res.json(await listClients(tenantOf(req), parse(listClientsQuerySchema, req.query)));
});

clientsRouter.post("/", ...authorize("clients:write"), async (req, res) => {
  res.status(201).json({ client: await createClient(tenantOf(req), parse(createClientSchema, req.body)) });
});

clientsRouter.get("/:id", ...authorize("clients:read"), async (req, res) => {
  res.json({ client: await getClient(tenantOf(req), parse(idSchema, req.params.id)) });
});

clientsRouter.patch("/:id", ...authorize("clients:write"), async (req, res) => {
  const clientId = parse(idSchema, req.params.id);
  res.json({ client: await updateClient(tenantOf(req), clientId, parse(updateClientSchema, req.body)) });
});

clientsRouter.delete("/:id", ...authorize("clients:delete"), async (req, res) => {
  await deleteClient(tenantOf(req), parse(idSchema, req.params.id));
  res.status(204).end();
});

// History timeline, newest first. Adding an event counts as editing the client.
clientsRouter.get("/:id/events", ...authorize("clients:read"), async (req, res) => {
  const clientId = parse(idSchema, req.params.id);
  res.json(await listClientEvents(tenantOf(req), clientId, parse(paginationQuerySchema, req.query)));
});

clientsRouter.post("/:id/events", ...authorize("clients:write"), async (req, res) => {
  const clientId = parse(idSchema, req.params.id);
  res.status(201).json({ event: await createClientEvent(tenantOf(req), clientId, parse(createClientEventSchema, req.body)) });
});
