-- Row-level security by workspace.
-- The API connects as a non-superuser role without BYPASSRLS (see src/db/app-role.ts) and sets these
-- per transaction with set_config(..., true): app.workspace_id, app.user_id, app.invite_token.
-- An unset or empty setting resolves to NULL, so a query outside a context sees no tenant rows.

CREATE OR REPLACE FUNCTION app_workspace_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.workspace_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint

-- Every tenant table: rows are visible and writable only inside their own workspace context.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'memberships', 'invitations', 'clients', 'client_events', 'pipeline_stages', 'deals', 'invoices',
    'invoice_items', 'ai_conversations', 'ai_messages', 'ai_pending_actions', 'client_embeddings',
    'audit_log', 'usage_counters'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id())',
      t
    );
  END LOOP;
END $$;
--> statement-breakpoint

-- A user can list their own memberships across workspaces (login, /auth/me, workspace switch).
CREATE POLICY own_memberships ON memberships FOR SELECT USING (user_id = app_user_id());
--> statement-breakpoint

-- An invitee can read exactly one invitation: the one whose token hash they present.
CREATE POLICY invite_by_token ON invitations FOR SELECT
  USING (token = nullif(current_setting('app.invite_token', true), ''));
--> statement-breakpoint

-- Workspaces: the row id is the tenant key.
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE workspaces FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON workspaces USING (id = app_workspace_id()) WITH CHECK (id = app_workspace_id());
--> statement-breakpoint
CREATE POLICY member_workspaces ON workspaces FOR SELECT
  USING (id IN (SELECT workspace_id FROM memberships WHERE user_id = app_user_id()));
