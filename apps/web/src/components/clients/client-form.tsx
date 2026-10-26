"use client";

import { CLIENT_STATUSES, createClientSchema, updateClientSchema } from "@crm/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { STATUS_LABELS } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import type { FieldErrors } from "@/lib/api";
import { api, isApiError } from "@/lib/api";
import { queryKeys, useMembers } from "@/lib/queries";
import type { Client } from "@/lib/types";
import { validate } from "@/lib/validation";

const FIELDS = ["name", "company", "email", "phone", "status", "ownerId", "notes"] as const;
type Values = Record<(typeof FIELDS)[number], string>;

const toValues = (c?: Client, defaultOwner = ""): Values => ({
  name: c?.name ?? "",
  company: c?.company ?? "",
  email: c?.email ?? "",
  phone: c?.phone ?? "",
  status: c?.status ?? "lead",
  ownerId: c ? (c.ownerId ?? "") : defaultOwner,
  notes: c?.notes ?? "",
});

interface ClientFormProps {
  /** Edit this client; omit to create one. */
  client?: Client;
  currentUserId: string;
  onDone: (client: Client) => void;
  onCancel: () => void;
}

export function ClientForm({ client, currentUserId, onDone, onCancel }: ClientFormProps) {
  const queryClient = useQueryClient();
  const { members, isPending: membersPending } = useMembers();
  const [initial] = useState(() => toValues(client, currentUserId));
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});

  const save = useMutation({
    mutationFn: (body: unknown) =>
      client
        ? api<{ client: Client }>(`/clients/${client.id}`, { method: "PATCH", body })
        : api<{ client: Client }>("/clients", { method: "POST", body }),
    onSuccess: ({ client: saved }) => {
      queryClient.setQueryData(queryKeys.client(saved.id), { client: saved });
      void queryClient.invalidateQueries({ queryKey: queryKeys.clientsAll });
      onDone(saved);
    },
    onError: (err) => {
      if (isApiError(err)) setErrors(err.fieldErrors);
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    let result;
    if (client) {
      // PATCH only what changed; a cleared optional field is sent as null.
      const changed = FIELDS.filter((f) => values[f].trim() !== initial[f].trim());
      if (changed.length === 0) return onCancel();
      const body = Object.fromEntries(changed.map((f) => [f, values[f].trim() === "" && f !== "name" ? null : values[f]]));
      result = validate(updateClientSchema, body);
    } else {
      const body = Object.fromEntries(FIELDS.map((f) => [f, values[f].trim() === "" ? undefined : values[f]]));
      result = validate(createClientSchema, body);
    }
    setErrors(result.errors ?? {});
    if (result.errors) {
      const first = Object.keys(result.errors)[0];
      document.querySelector<HTMLElement>(`[name="client-${first}"]`)?.focus();
      return;
    }
    save.mutate(result.data);
  }

  const bind = (key: keyof Values) => ({
    name: `client-${key}`,
    value: values[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setValues((v) => ({ ...v, [key]: e.target.value })),
  });
  const serverError = save.error && Object.keys(errors).length === 0 ? save.error.message : null;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {serverError && <Alert>{serverError}</Alert>}
      <Field label="Name" error={errors.name} required>
        {(p) => <Input {...p} {...bind("name")} autoComplete="off" placeholder="John Smith" />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company" error={errors.company}>
          {(p) => <Input {...p} {...bind("company")} autoComplete="off" placeholder="ABC Ltd" />}
        </Field>
        <Field label="Status" error={errors.status}>
          {(p) => (
            <Select {...p} {...bind("status")}>
              {CLIENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Email" error={errors.email}>
          {(p) => <Input {...p} {...bind("email")} type="email" inputMode="email" autoComplete="off" placeholder="john@abc.com" />}
        </Field>
        <Field label="Phone" error={errors.phone}>
          {(p) => <Input {...p} {...bind("phone")} type="tel" inputMode="tel" autoComplete="off" placeholder="+1 555 0100" />}
        </Field>
      </div>
      <Field label="Owner" error={errors.ownerId} hint="The teammate responsible for this client.">
        {(p) => (
          <Select {...p} {...bind("ownerId")} disabled={membersPending}>
            {client && <option value="">Unassigned</option>}
            {/* Until members load, keep the current value selectable so the form stays valid. */}
            {membersPending && values.ownerId && <option value={values.ownerId}>Loading…</option>}
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
                {m.userId === currentUserId ? " (you)" : ""}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Notes" error={errors.notes}>
        {(p) => <Textarea {...p} {...bind("notes")} rows={3} placeholder="Preferences, context, anything the team should know" />}
      </Field>
      <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onCancel} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {client ? "Save changes" : "Add client"}
        </Button>
      </div>
    </form>
  );
}
