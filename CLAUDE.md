# AI CRM

Multi-tenant CRM with a natural-language AI agent. First user: RightClixs (4 sellers + 1 project manager). Later: subscription SaaS (Free / Premium $10 per month).
Full spec: `docs/SPEC.md`. Read it before building any feature.

## Stack
- Frontend: Next.js (App Router), TypeScript, Tailwind CSS (`apps/web`)
- Backend: Node.js, Express, TypeScript, REST (`apps/api`)
- DB: PostgreSQL + pgvector, Drizzle ORM, row-level security by `workspace_id`
- Auth: own JWT in httpOnly cookies, argon2 password hashing
- AI: provider interface with Claude adapter (Mistral and Gemini adapters later)
- Run: Docker Compose on Hostinger VPS. No Kubernetes or Redis in v1.

## Structure
```
apps/web        Next.js app
apps/api        Express API (routes / services / db / ai)
packages/shared Zod schemas and shared types
docs/           SPEC.md, user stories, test plan
.claude/skills  One folder per skill, each with SKILL.md
docker-compose.yml
```

## Rules
1. TypeScript strict. No `any`. Validate every request body with Zod from `packages/shared`.
2. Every table has `workspace_id`. Every query runs inside a workspace context (RLS on). Never trust a `workspace_id` sent by the client; take it from the session.
3. Every route checks the role permission (see the matrix in `docs/SPEC.md`) in middleware, not in the handler.
4. AI agent write actions never execute directly. They create a `pending_action`, the user confirms, then the API executes it with the user's own permissions. Log everything in `audit_log`.
5. LLM calls only go through `apps/api/src/ai/provider.ts`. No provider SDK calls elsewhere.
6. Secrets only in `.env` (never committed). Provide `.env.example`.
7. Each feature ships with its tests (see Testing). Do not mark a task done if tests fail.
8. UI: glassy style, dark and light mode via CSS variables, mobile-friendly. Use the ui-ux-pro-max skill for design decisions.

## Workflow (keep token use low)
- Work one feature at a time from `docs/SPEC.md` section "Build order". State the plan in 5 lines or less, then implement.
- Read only the files you need. Do not re-read the whole repo. Use Graphify output to locate code.
- Do not paste large files back. Show diffs or summaries.
- After each feature: run lint, typecheck, tests. Then commit with a clear message.

## Testing
- API: Vitest + Supertest. Test auth, role permissions, and workspace isolation for every resource.
- Agent: test that write tools create pending actions and that role limits are enforced.
- UI: manual checklist in `docs/SPEC.md` for the demo.

## Skills
Place skills in `.claude/skills/<skill-name>/SKILL.md` (Claude Code auto-detects this path).
Suggested: authentication-authorization, nextjs-app-router, drizzle-postgres, rbac-multitenancy, ai-agent-tools, ui-ux-pro-max.
Review any third-party skill before installing.

## Commands
- `docker compose up -d db` start Postgres
- `pnpm dev` run web + api
- `pnpm test` run all tests
- `pnpm db:migrate` apply migrations
