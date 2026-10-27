"use client";

import { can, createDealSchema, updateDealSchema } from "@crm/shared";
import type { Role } from "@crm/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ClientPicker } from "@/components/clients/client-picker";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input, Select } from "@/components/ui/field";
import type { FieldErrors } from "@/lib/api";
import { api, isApiError } from "@/lib/api";
import { queryKeys, useMembers } from "@/lib/queries";
import type { Deal, Stage } from "@/lib/types";
import { validate } from "@/lib/validation";

const FIELDS = ["clientId", "title", "value", "currency", "stageId", "ownerId"] as const;
type Values = Record<(typeof FIELDS)[number], string>;

const toValues = (deal: Deal | undefined, stageId: string, userId: string): Values => ({
  clientId: deal?.clientId ?? "",
  title: deal?.title ?? "",
  value: deal ? String(deal.value) : "",
  currency: deal?.currency ?? "USD",
  stageId: deal?.stageId ?? stageId,
  ownerId: deal ? (deal.ownerId ?? "") : userId,
});

interface DealFormProps {
  /** Edit this deal; omit to create one. */
  deal?: Deal;
  stages: Stage[];
  /** Column for a new deal. */
  defaultStageId?: string;
  me: { id: string; role: Role };
  onDone: (deal: Deal) => void;
  onCancel: () => void;
}

export function DealForm({ deal, stages, defaultStageId, me, onDone, onCancel }: DealFormProps) {
  const queryClient = useQueryClient();
  const { members, isPending: membersPending } = useMembers();
  const canReassign = can(me.role, "deals:reassign");
  const [initial] = useState(() => toValues(deal, defaultStageId ?? stages[0]?.id ?? "", me.id));
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});

  const save = useMutation({
    mutationFn: (body: unknown) =>
      deal
        ? api<{ deal: Deal }>(`/deals/${deal.id}`, { method: "PATCH", body })
        : api<{ deal: Deal }>("/deals", { method: "POST", body }),
    onSuccess: ({ deal: saved }) => {
      queryClient.setQueryData<{ deals: Deal[] }>(queryKeys.deals, (data) =>
        data && { deals: deal ? data.deals.map((d) => (d.id === saved.id ? saved : d)) : [...data.deals, saved] },
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.deals });
      onDone(saved);
    },
    onError: (err) => {
      if (isApiError(err)) setErrors(err.fieldErrors);
    },
  });

  // Form strings to API values: money as a number, "" owner as unassigned (null).
  const toBody = (keys: readonly (keyof Values)[]) =>
    Object.fromEntries(
      keys.map((k) => {
        const v = values[k].trim();
        if (k === "value") return [k, v === "" ? (deal ? undefined : 0) : Number(v)];
        if (k === "ownerId") return [k, v === "" ? null : v];
        return [k, v === "" ? undefined : v];
      }),
    );

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    let result;
    if (deal) {
      const editable = FIELDS.filter((f) => f !== "stageId" && (f !== "ownerId" || canReassign));
      const changed = editable.filter((f) => values[f].trim() !== initial[f].trim());
      if (changed.length === 0) return onCancel();
      result = validate(updateDealSchema, toBody(changed));
    } else {
      // Sellers leave the owner out: the API makes the creator the owner.
      result = validate(createDealSchema, toBody(FIELDS.filter((f) => f !== "ownerId" || canReassign)));
    }
    setErrors(result.errors ?? {});
    if (result.errors) {
      const first = Object.keys(result.errors)[0];
      document.querySelector<HTMLElement>(`[name="deal-${first}"]`)?.focus();
      return;
    }
    save.mutate(result.data);
  }

  const set = (key: keyof Values, value: string) => setValues((v) => ({ ...v, [key]: value }));
  const bind = (key: keyof Values) => ({
    name: `deal-${key}`,
    value: values[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => set(key, e.target.value),
  });
  const serverError = save.error && Object.keys(errors).length === 0 ? save.error.message : null;
  const ownerName = deal?.ownerId ? members.find((m) => m.userId === deal.ownerId)?.name : undefined;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {serverError && <Alert>{serverError}</Alert>}
      <Field label="Client" error={errors.clientId} required>
        {(p) => <ClientPicker {...p} name="deal-clientId" value={values.clientId} currentName={deal?.clientName} onChange={(id) => set("clientId", id)} />}
      </Field>
      <Field label="Title" error={errors.title} required>
        {(p) => <Input {...p} {...bind("title")} autoComplete="off" placeholder="Website redesign" />}
      </Field>
      <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-4">
        <Field label="Value" error={errors.value}>
          {(p) => <Input {...p} {...bind("value")} type="number" inputMode="decimal" min={0} step="0.01" placeholder="0.00" className="tabular-nums" />}
        </Field>
        <Field label="Currency" error={errors.currency}>
          {(p) => <Input {...p} {...bind("currency")} autoComplete="off" maxLength={3} className="uppercase" />}
        </Field>
      </div>
      {!deal && (
        <Field label="Stage" error={errors.stageId} required>
          {(p) => (
            <Select {...p} {...bind("stageId")}>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <Field
        label="Owner"
        error={errors.ownerId}
        hint={canReassign ? "The teammate responsible for this deal." : "Only admins and project managers can reassign deals."}
      >
        {(p) =>
          canReassign ? (
            <Select {...p} {...bind("ownerId")} disabled={membersPending}>
              <option value="">Unassigned</option>
              {membersPending && values.ownerId && <option value={values.ownerId}>Loading…</option>}
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                  {m.userId === me.id ? " (you)" : ""}
                </option>
              ))}
            </Select>
          ) : (
            <Input {...p} readOnly value={deal ? (deal.ownerId === me.id ? "You" : (ownerName ?? "Unassigned")) : "You"} className="bg-transparent" />
          )
        }
      </Field>
      <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onCancel} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {deal ? "Save changes" : "Create deal"}
        </Button>
      </div>
    </form>
  );
}
