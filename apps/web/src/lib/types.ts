import type { ClientEventType, ClientStatus, Plan, Role } from "@crm/shared";

// Response shapes of the API (apps/api/src/routes). Dates arrive as ISO strings.

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Workspace {
  id: string;
  name: string;
  plan: Plan;
  role: Role;
}

export interface Me {
  user: User;
  workspace: Workspace | null;
  workspaces: Workspace[];
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: string;
}

export interface Client {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  status: ClientStatus;
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClientEvent {
  id: string;
  clientId: string;
  type: ClientEventType;
  title: string;
  body: string | null;
  amount: number | null;
  createdBy: string | null;
  createdAt: string;
}

export interface Page {
  total: number;
  limit: number;
  offset: number;
}

export interface Stage {
  id: string;
  name: string;
  position: number;
}

export interface Deal {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  value: number;
  currency: string;
  stageId: string;
  position: number;
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
}
