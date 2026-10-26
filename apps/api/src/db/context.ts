import { sql } from "drizzle-orm";
import { db } from "./client";

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Values the RLS policies read (see drizzle/0003_rls.sql). Missing values become NULL in SQL. */
export interface DbContext {
  userId?: string;
  workspaceId?: string;
  inviteTokenHash?: string;
}

/** Sets the RLS context for the rest of the transaction (set_config with is_local = true). */
export async function setDbContext(tx: Tx, ctx: DbContext): Promise<void> {
  await tx.execute(sql`select
    set_config('app.user_id', ${ctx.userId ?? ""}, true),
    set_config('app.workspace_id', ${ctx.workspaceId ?? ""}, true),
    set_config('app.invite_token', ${ctx.inviteTokenHash ?? ""}, true)`);
}

/** Runs fn in a transaction whose queries only see rows the context allows. */
export function withDbContext<T>(ctx: DbContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await setDbContext(tx, ctx);
    return fn(tx);
  });
}
