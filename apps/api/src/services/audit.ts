import type { Tx } from "../db/context";
import { auditLog } from "../db/schema";

export interface AuditEntry {
  workspaceId: string;
  userId: string;
  action: string;
  entity: string;
  entityId?: string | null;
  meta?: Record<string, unknown>;
}

/** Writes an audit row inside the caller's transaction, so it commits or rolls back with the change. */
export async function audit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    workspaceId: entry.workspaceId,
    userId: entry.userId,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    meta: entry.meta ?? null,
  });
}
