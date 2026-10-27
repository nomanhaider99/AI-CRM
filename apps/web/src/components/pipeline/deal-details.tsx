"use client";

import type { Role } from "@crm/shared";
import { ArrowUpRight, Lock, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Avatar } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Select } from "@/components/ui/field";
import { formatDate, formatMoney } from "@/lib/format";
import type { Deal, Stage } from "@/lib/types";
import { DealForm } from "./deal-form";
import { useDeleteDeal } from "./use-deal-mutations";

interface DealDetailsProps {
  deal: Deal;
  stages: Stage[];
  me: { id: string; role: Role };
  ownerLabel: string | undefined;
  lockReason: string | undefined;
  onMove: (dealId: string, stageId: string, index: number) => Promise<void>;
  onDeleted: (deal: Deal) => void;
}

/** Drawer body: details, a stage picker (the non-drag way to move a card), edit and delete. */
export function DealDetails({ deal, stages, me, ownerLabel, lockReason, onMove, onDeleted }: DealDetailsProps) {
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  const remove = useDeleteDeal(onDeleted);
  const locked = lockReason !== undefined;

  if (mode === "edit") {
    return <DealForm deal={deal} stages={stages} me={me} onDone={() => setMode("view")} onCancel={() => setMode("view")} />;
  }

  return (
    <div className="space-y-6">
      {locked && (
        <div className="flex items-start gap-2.5 rounded-xl bg-neutral-soft px-3.5 py-3 text-sm text-neutral-text">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>View only. {lockReason}</span>
        </div>
      )}

      <p className="text-3xl font-bold tracking-tight text-fg tabular-nums">{formatMoney(deal.value, deal.currency)}</p>

      <dl className="divide-y divide-border rounded-xl border border-border">
        <Row label="Client">
          <Link
            href={`/clients/${deal.clientId}`}
            className="inline-flex items-center gap-1 font-medium text-primary-text underline-offset-2 hover:underline"
          >
            {deal.clientName}
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </Link>
        </Row>
        <Row label="Owner">
          {deal.ownerId && ownerLabel ? (
            <span className="inline-flex items-center gap-2">
              <Avatar name={ownerLabel} size="sm" className="size-6 text-[10px]" />
              {ownerLabel}
              {deal.ownerId === me.id && <span className="text-muted">(you)</span>}
            </span>
          ) : (
            <span className="text-muted">{ownerLabel ?? "…"}</span>
          )}
        </Row>
        <Row label="Stage">
          {locked ? (
            stages.find((s) => s.id === deal.stageId)?.name
          ) : (
            <Select
              aria-label="Stage"
              value={deal.stageId}
              // A new stage puts the card at the bottom of that column, like a drop past the last card.
              onChange={(e) => void onMove(deal.id, e.target.value, Number.MAX_SAFE_INTEGER)}
              className="h-10 w-auto min-w-36"
            >
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Row>
        <Row label="Created">{formatDate(deal.createdAt)}</Row>
        <Row label="Updated">{formatDate(deal.updatedAt)}</Row>
      </dl>

      {!locked &&
        (mode === "delete" ? (
          <div className="space-y-3 rounded-xl border border-danger/30 bg-danger-soft p-4">
            <p className="text-sm font-semibold text-fg">Delete this deal?</p>
            <p className="text-sm text-muted">It leaves the board for everyone. Invoices linked to it are kept. This can&apos;t be undone.</p>
            {remove.error && <Alert>{remove.error.message}</Alert>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={() => setMode("view")} disabled={remove.isPending}>
                Keep deal
              </Button>
              <Button variant="danger" onClick={() => remove.mutate(deal)} loading={remove.isPending}>
                Delete deal
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
            <Button variant="secondary" onClick={() => setMode("edit")}>
              <Pencil className="size-4" aria-hidden="true" />
              Edit deal
            </Button>
            <Button variant="ghost" onClick={() => setMode("delete")} className="text-danger-text hover:bg-danger-soft hover:text-danger-text">
              <Trash2 className="size-4" aria-hidden="true" />
              Delete
            </Button>
          </div>
        ))}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 px-3.5 py-2 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 text-right text-fg">{children}</dd>
    </div>
  );
}
