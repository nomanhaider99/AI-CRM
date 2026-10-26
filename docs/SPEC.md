# AI CRM: Demo Spec (v0.1)

## 1. Goal
Show a working CRM where a team can manage clients, a Kanban sales board, and invoices, with an AI agent that does CRM tasks from natural language and summarizes a client's history for new sellers.

## 2. Scope
In: landing, pricing page (display only), signup/login, workspaces, invites, 3 roles, clients + history timeline, Kanban, invoices, AI agent (Claude), dark/light glass UI, Docker deploy.
Out (after demo): Stripe billing, Mistral/Gemini adapters, WhatsApp/Dialpad import, S3, Redis, Kubernetes, email sending (show invite link instead).

## 3. Roles and permissions (proposal)
| Action | Admin | Project Manager | Seller |
|---|---|---|---|
| Manage workspace, members, roles, plan | Yes | No | No |
| View all clients | Yes | Yes | Yes |
| Create / edit clients | Yes | Yes | Yes |
| Delete clients | Yes | No | No |
| View all deals | Yes | Yes | Own + unassigned |
| Create / move deals | Yes | Yes | Own |
| Reassign deals | Yes | Yes | No |
| Create / edit invoices | Yes | Yes | Own deals only |
| Delete invoices | Yes | No | No |
| Use AI agent | Yes | Yes | Yes (same limits as their role) |
| View audit log | Yes | Yes | No |

## 4. Plans and limits (placeholder numbers, change freely)
| Limit | Free | Premium ($10/month) |
|---|---|---|
| Members | 2 | 10 |
| Clients | 25 | Unlimited |
| AI messages per month | 30 | 1,000 |
| Invoices per month | 5 | Unlimited |
| File storage | 100 MB | 5 GB |
Enforced through `usage_counters` and a `plan` column on `workspaces`.

## 5. Data model
All tables below (except `users`) include `workspace_id` and `created_at`.
- `users`: id, email, password_hash, name
- `workspaces`: id, name, owner_id, plan (`free`|`premium`), ai_model
- `memberships`: workspace_id, user_id, role (`admin`|`pm`|`seller`)
- `invitations`: id, workspace_id, email, role, token, expires_at, accepted_at
- `clients`: id, name, company, email, phone, notes, status, owner_id
- `client_events` (history timeline): id, client_id, type (`sale`|`note`|`call`|`message`|`invoice`), title, body, amount, created_by
- `pipeline_stages`: id, name, position (default: Lead, Contacted, Proposal, Won, Lost)
- `deals` (Kanban cards): id, client_id, title, value, currency, stage_id, position, owner_id
- `invoices`: id, client_id, deal_id, number, status (`draft`|`sent`|`paid`), issue_date, due_date, total, currency
- `invoice_items`: id, invoice_id, description, qty, unit_price
- `ai_conversations`, `ai_messages`: chat history per user
- `ai_pending_actions`: id, conversation_id, tool, args (jsonb), status (`pending`|`confirmed`|`rejected`|`executed`), user_id
- `client_embeddings`: client_id, content, embedding vector(1536)
- `audit_log`: id, user_id, action, entity, entity_id, meta (jsonb)
- `usage_counters`: workspace_id, period (YYYY-MM), metric, value

Multi-tenancy: set `app.workspace_id` per request and enable RLS policies `workspace_id = current_setting('app.workspace_id')::uuid`.

## 6. API (REST, prefix `/api`)
- Auth: `POST /auth/signup`, `/auth/login`, `/auth/logout`, `GET /auth/me`
- Workspaces: `POST /workspaces`, `GET /workspaces/current`, `PATCH /workspaces/current`
- Members: `GET /members`, `POST /invitations`, `POST /invitations/:token/accept`, `PATCH /members/:id` (role), `DELETE /members/:id`
- Clients: `GET/POST /clients`, `GET/PATCH/DELETE /clients/:id`, `GET/POST /clients/:id/events`, `GET /clients/:id/summary` (AI)
- Deals: `GET/POST /deals`, `PATCH /deals/:id` (stage, position, owner), `DELETE /deals/:id`
- Stages: `GET /stages`
- Invoices: `GET/POST /invoices`, `GET/PATCH/DELETE /invoices/:id`
- AI: `POST /ai/chat` (stream), `POST /ai/actions/:id/confirm`, `POST /ai/actions/:id/reject`
- Usage: `GET /usage`

## 7. AI agent design
One orchestrator, four specialist tool groups (called sub-agents in the UI):
- Client agent: `search_clients`, `create_client`, `update_client`
- Deal agent: `create_deal`, `move_deal`
- Invoice agent: `create_invoice`, `add_invoice_item`, `mark_invoice_paid`
- History agent: `get_client_history`, `summarize_client` (what was sold, total spent, last contact, open deals), `add_note`

Flow: user message, orchestrator picks tools, read tools run immediately, write tools create a `pending_action` shown as a confirm card, the user confirms, the API executes using the user's role permissions, and the audit log records it.
Safety: the agent can never exceed the user's role; reject cross-workspace IDs; count each message in `usage_counters`; show a clear message when the limit is hit.
Provider interface: `generate()`, `stream()`, `callTool()`. Claude adapter now; Mistral and Gemini adapters later.

## 8. Pages
Public: Landing (hero, features, how the AI agent works, demo screenshots, pricing, FAQ), Pricing, Login, Signup.
App: Onboarding (create workspace), Dashboard (totals, recent activity), Kanban, Clients list, Client detail (chat-style timeline), Invoices, Members and roles, Settings (plan, AI model), AI agent panel (docked chat on every page).

## 9. Build order
1. Repo, Docker Compose, DB, migrations, shared Zod package
2. Auth, workspaces, memberships, RLS, role middleware
3. Clients and client events
4. Kanban (deals, stages, drag and drop)
5. Invoices
6. AI agent (read tools, then write tools with confirmation)
7. Landing and pricing pages, UI polish, dark/light mode
8. Seed demo data (RightClixs workspace, 4 sellers, 1 PM, ~15 clients, sample deals and invoices)
9. Deploy to VPS, generate Graphify diagram, rehearse demo

## 10. User stories
1. As a visitor, I can read the landing page and pricing so I understand the product.
2. As a visitor, I can sign up and create a workspace.
3. As an admin, I can invite a member and assign a role.
4. As an admin, I can change or remove a member's role.
5. As a seller, I can add a client with contact details.
6. As a seller, I can open a client and read what was sold, for how much, and what was discussed, in a timeline.
7. As a seller, I can add a note or sale event to a client's timeline.
8. As a seller, I can create a deal card and drag it between stages.
9. As a PM, I can see all deals and reassign them.
10. As a seller, I can create an invoice for a client and mark it paid.
11. As a new seller, I can ask the AI "summarize this client" and get history, total spent, and open deals.
12. As a user, I can tell the AI "add client John, ABC Ltd, john@abc.com" and confirm the action.
13. As a user, I can tell the AI "create an invoice for John, 3 logo designs at $50" and confirm.
14. As an admin, I can see AI usage against my plan limit.
15. As a user, I can switch between dark and light mode.

## 11. Test checklist
Automated (Vitest + Supertest):
- Signup, login, logout, and invalid credentials
- A user cannot read or write another workspace's data (every resource)
- Seller cannot delete clients or invoices; PM cannot manage members
- Moving a deal updates stage and position
- Invoice totals are calculated from items
- AI write tools create pending actions and do not execute before confirm
- AI cannot run an action the user's role forbids
- Plan limits block the 3rd member and the 31st AI message on Free

Manual demo run:
- Sign up, create workspace, invite a seller, log in as the seller
- Add a client, add a deal, drag across stages, create an invoice
- Ask the AI to summarize a client and to add an invoice, then confirm
- Toggle dark/light mode, check on mobile width
