import type { ClientEventType, ClientStatus, InvoiceStatus, Plan, Role } from "@crm/shared";

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

export interface Invoice {
  id: string;
  number: string;
  status: InvoiceStatus;
  clientId: string;
  clientName: string;
  clientCompany: string | null;
  clientEmail: string | null;
  dealId: string | null;
  /** null when there is no deal, or the deal belongs to another member and the caller is a seller. */
  dealTitle: string | null;
  dealOwnerId: string | null;
  /** YYYY-MM-DD */
  issueDate: string;
  dueDate: string | null;
  total: number;
  currency: string;
  paidAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceItem {
  id: string;
  description: string;
  qty: number;
  unitPrice: number;
  amount: number;
}

export interface InvoiceDetail extends Invoice {
  items: InvoiceItem[];
}
