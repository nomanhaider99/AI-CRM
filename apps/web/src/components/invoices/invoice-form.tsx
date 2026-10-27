"use client";

import type { Role } from "@crm/shared";
import { can, createInvoiceSchema, invoiceItemSchema, invoiceTotals, updateInvoiceSchema } from "@crm/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ClientPicker } from "@/components/clients/client-picker";
import { Button, IconButton } from "@/components/ui/button";
import { Alert, LoadingLabel, Skeleton } from "@/components/ui/feedback";
import { controlClass, Field, Input, Select } from "@/components/ui/field";
import type { FieldErrors } from "@/lib/api";
import { api, isApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatCurrency, isoDay } from "@/lib/format";
import { queryKeys } from "@/lib/queries";
import type { Deal, InvoiceDetail } from "@/lib/types";
import { validate } from "@/lib/validation";

interface ItemRow {
  /** Stable React key; rows have no id until saved. */
  key: number;
  description: string;
  qty: string;
  unitPrice: string;
}
type ItemErrors = Partial<Record<"description" | "qty" | "unitPrice", string>>;

interface Values {
  clientId: string;
  dealId: string;
  status: "draft" | "sent";
  currency: string;
  issueDate: string;
  dueDate: string;
}

let nextKey = 1;
const emptyRow = (): ItemRow => ({ key: nextKey++, description: "", qty: "1", unitPrice: "" });

// Inputs hold strings; an empty or unparsable number becomes NaN so validation reports it.
const toNumber = (s: string) => (s.trim() === "" ? Number.NaN : Number(s));
const toItem = (r: ItemRow) => ({ description: r.description, qty: toNumber(r.qty), unitPrice: toNumber(r.unitPrice) });
// For the live totals, half-typed rows count as zero.
const liveLine = (r: ItemRow) => {
  const qty = toNumber(r.qty);
  const unitPrice = toNumber(r.unitPrice);
  return { qty: Number.isFinite(qty) && qty > 0 ? qty : 0, unitPrice: Number.isFinite(unitPrice) && unitPrice > 0 ? unitPrice : 0 };
};

function rowErrors(rows: ItemRow[]): ItemErrors[] {
  return rows.map((r) => {
    const res = invoiceItemSchema.safeParse(toItem(r));
    if (res.success) return {};
    const out: ItemErrors = {};
    for (const issue of res.error.issues) {
      const key = issue.path[0] as keyof ItemErrors;
      if (out[key]) continue;
      out[key] = key === "description" ? "Describe the item" : key === "qty" ? "Enter a quantity above 0" : "Enter a price (0 or more, 2 decimals)";
    }
    return out;
  });
}

interface InvoiceFormProps {
  /** Edit this invoice; omit to create one. */
  invoice?: InvoiceDetail;
  /** Preselected client for a new invoice (e.g. from the client page). */
  defaultClientId?: string;
  defaultClientName?: string;
  me: { id: string; role: Role };
  onDone: (invoice: InvoiceDetail) => void;
  onCancel: () => void;
}

export function InvoiceForm({ invoice, defaultClientId, defaultClientName, me, onDone, onCancel }: InvoiceFormProps) {
  const queryClient = useQueryClient();
  const manager = can(me.role, "invoices:write_any");
  const [initial] = useState<Values>(() => ({
    clientId: invoice?.clientId ?? defaultClientId ?? "",
    dealId: invoice?.dealId ?? "",
    status: invoice?.status === "sent" ? "sent" : "draft",
    currency: invoice?.currency ?? "USD",
    issueDate: invoice?.issueDate ?? isoDay(),
    dueDate: invoice ? (invoice.dueDate ?? "") : isoDay(14),
  }));
  const [initialRows] = useState<ItemRow[]>(() =>
    invoice ? invoice.items.map((i) => ({ key: nextKey++, description: i.description, qty: String(i.qty), unitPrice: String(i.unitPrice) })) : [emptyRow()],
  );
  const [values, setValues] = useState(initial);
  const [rows, setRows] = useState(initialRows);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [itemErrors, setItemErrors] = useState<ItemErrors[]>([]);
  const focusRow = useRef<number | null>(null);
  const itemsRef = useRef<HTMLDivElement>(null);

  // Deals of the chosen client that this user may invoice: managers any, sellers their own.
  const dealsQuery = useQuery({
    queryKey: [...queryKeys.deals, { clientId: values.clientId }],
    queryFn: ({ signal }) => api<{ deals: Deal[] }>("/deals", { query: { clientId: values.clientId }, signal }),
    enabled: values.clientId !== "",
  });
  const dealOptions = (dealsQuery.data?.deals ?? []).filter((d) => manager || d.ownerId === me.id);

  // A seller with exactly one deal for this client gets it preselected.
  const dealId = values.dealId || (!invoice && !manager && dealOptions.length === 1 ? dealOptions[0]!.id : "");
  // A seller may not see the deal an invoice is on; keep it as an option so the select shows the truth.
  const currentDealMissing = invoice?.dealId && dealId === invoice.dealId && !dealOptions.some((d) => d.id === invoice.dealId);

  useEffect(() => {
    if (focusRow.current === null) return;
    itemsRef.current?.querySelector<HTMLElement>(`[name="item-${focusRow.current}-description"]`)?.focus();
    focusRow.current = null;
  }, [rows.length]);

  const save = useMutation({
    mutationFn: (body: unknown) =>
      invoice
        ? api<{ invoice: InvoiceDetail }>(`/invoices/${invoice.id}`, { method: "PATCH", body })
        : api<{ invoice: InvoiceDetail }>("/invoices", { method: "POST", body }),
    onSuccess: ({ invoice: saved }) => {
      queryClient.setQueryData(queryKeys.invoice(saved.id), { invoice: saved });
      void queryClient.invalidateQueries({ queryKey: queryKeys.invoicesAll });
      void queryClient.invalidateQueries({ queryKey: queryKeys.events(saved.clientId) });
      onDone(saved);
    },
    onError: (err) => {
      if (isApiError(err)) setErrors(err.fieldErrors);
    },
  });

  const totals = invoiceTotals(rows.map(liveLine));
  const currency = /^[A-Za-z]{3}$/.test(values.currency.trim()) ? values.currency.trim().toUpperCase() : "USD";

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const perRow = rowErrors(rows);
    const items = rows.map(toItem);

    let result;
    if (invoice) {
      const body: Record<string, unknown> = {};
      if (dealId !== initial.dealId) body.dealId = dealId === "" ? null : dealId;
      if (values.status !== initial.status) body.status = values.status;
      if (values.currency.trim().toUpperCase() !== initial.currency) body.currency = values.currency;
      if (values.issueDate !== initial.issueDate) body.issueDate = values.issueDate;
      if (values.dueDate !== initial.dueDate) body.dueDate = values.dueDate === "" ? null : values.dueDate;
      if (JSON.stringify(items) !== JSON.stringify(initialRows.map(toItem))) body.items = items;
      if (Object.keys(body).length === 0) return onCancel();
      result = validate(updateInvoiceSchema, body);
    } else {
      result = validate(createInvoiceSchema, {
        clientId: values.clientId || undefined,
        dealId: dealId || undefined,
        status: values.status,
        currency: values.currency,
        issueDate: values.issueDate || undefined,
        dueDate: values.dueDate || undefined,
        items,
      });
    }

    const fieldErrors: FieldErrors = { ...(result.errors ?? {}) };
    if (!invoice && !manager && !dealId) fieldErrors.dealId = ["Choose one of your deals for this client"];
    setErrors(fieldErrors);
    setItemErrors(perRow);
    const firstRow = perRow.findIndex((r) => Object.keys(r).length > 0);
    const firstField = Object.keys(fieldErrors).find((k) => k !== "items" && k !== "_form");
    if (firstField || firstRow >= 0 || fieldErrors.items || fieldErrors._form) {
      const target = firstField
        ? `[name="invoice-${firstField}"]`
        : firstRow >= 0
          ? `[name="item-${rows[firstRow]!.key}-${Object.keys(perRow[firstRow]!)[0]}"]`
          : `[name="item-${rows[0]!.key}-description"]`;
      document.querySelector<HTMLElement>(target)?.focus();
      return;
    }
    save.mutate(result.data);
  }

  const set = <K extends keyof Values>(key: K, value: Values[K]) => setValues((v) => ({ ...v, [key]: value }));
  const bind = (key: Exclude<keyof Values, "status">) => ({
    name: `invoice-${key}`,
    value: values[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => set(key, e.target.value),
  });
  const setRow = (key: number, patch: Partial<ItemRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = () => {
    const row = emptyRow();
    focusRow.current = row.key;
    setRows((rs) => [...rs, row]);
  };
  const removeRow = (key: number) => {
    const index = rows.findIndex((r) => r.key === key);
    setRows((rs) => rs.filter((r) => r.key !== key));
    setItemErrors((es) => es.filter((_, i) => i !== index));
  };

  const fieldCount = Object.keys(errors).filter((k) => k !== "_form").length + itemErrors.filter((r) => Object.keys(r).length > 0).length;
  const serverError = save.error && Object.keys(errors).length === 0 ? save.error.message : null;
  const listError = errors.items?.[0] ?? errors._form?.[0];

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      {serverError && <Alert>{serverError}</Alert>}
      {!serverError && fieldCount > 0 && (
        <Alert>
          {fieldCount === 1 ? "One field needs attention." : `${fieldCount} fields need attention.`} They're marked below.
        </Alert>
      )}

      <fieldset className="space-y-4">
        <legend className="mb-3 text-sm font-semibold text-fg">Details</legend>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Client" error={errors.clientId} required hint={invoice ? "The client can't change once an invoice exists." : undefined}>
            {(p) =>
              invoice ? (
                <Input {...p} readOnly value={invoice.clientCompany ? `${invoice.clientName} · ${invoice.clientCompany}` : invoice.clientName} className="bg-transparent" />
              ) : (
                <ClientPicker
                  {...p}
                  name="invoice-clientId"
                  value={values.clientId}
                  currentName={defaultClientName}
                  onChange={(id) => setValues((v) => ({ ...v, clientId: id, dealId: "" }))}
                />
              )
            }
          </Field>
          <Field
            label="Deal"
            error={errors.dealId}
            required={!manager}
            hint={manager ? "Optional. Link the invoice to a deal on this client." : "Sellers invoice their own deals."}
          >
            {(p) => (
              <Select {...p} {...bind("dealId")} value={dealId} disabled={values.clientId === "" || dealsQuery.isPending}>
                <option value="">
                  {values.clientId === ""
                    ? "Choose a client first"
                    : dealsQuery.isPending
                      ? "Loading deals…"
                      : dealOptions.length === 0 && !manager
                        ? "No deals of yours for this client"
                        : manager
                          ? "No deal"
                          : "Choose a deal"}
                </option>
                {currentDealMissing && <option value={invoice.dealId!}>{invoice.dealTitle ?? "Current deal"}</option>}
                {dealOptions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title} · {formatCurrency(d.value, d.currency)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field label="Issue date" error={errors.issueDate} required>
            {(p) => <Input {...p} {...bind("issueDate")} type="date" />}
          </Field>
          <Field label="Due date" error={errors.dueDate}>
            {(p) => <Input {...p} {...bind("dueDate")} type="date" min={values.issueDate || undefined} />}
          </Field>
          <Field label="Status" error={errors.status} hint="Mark it paid from the invoice page.">
            {(p) => (
              <Select {...p} name="invoice-status" value={values.status} onChange={(e) => set("status", e.target.value === "sent" ? "sent" : "draft")}>
                <option value="draft">Draft</option>
                <option value="sent">Sent</option>
              </Select>
            )}
          </Field>
          <Field label="Currency" error={errors.currency}>
            {(p) => <Input {...p} {...bind("currency")} autoComplete="off" maxLength={3} className="uppercase" />}
          </Field>
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-3 text-sm font-semibold text-fg">Line items</legend>
        {listError && (
          <p className="mb-3 text-xs font-medium text-danger-text" role="alert">
            {listError}
          </p>
        )}
        <div className="hidden grid-cols-[minmax(0,1fr)_6rem_8rem_8rem_2.75rem] gap-3 px-1 pb-2 text-xs font-semibold tracking-wide text-muted uppercase md:grid">
          <span>Description</span>
          <span>Qty</span>
          <span>Unit price</span>
          <span className="text-right">Amount</span>
          <span className="sr-only">Remove</span>
        </div>
        <div ref={itemsRef} className="space-y-3">
          {rows.map((row, i) => (
            <ItemRowFields
              key={row.key}
              row={row}
              index={i}
              errors={itemErrors[i] ?? {}}
              amount={formatCurrency(totals.lines[i] ?? 0, currency)}
              canRemove={rows.length > 1}
              onChange={(patch) => setRow(row.key, patch)}
              onRemove={() => removeRow(row.key)}
            />
          ))}
        </div>
        <Button variant="secondary" size="sm" onClick={addRow} className="mt-3" disabled={rows.length >= 200}>
          <Plus className="size-4" aria-hidden="true" />
          Add item
        </Button>

        <dl className="mt-5 ml-auto max-w-xs space-y-2 border-t border-border pt-4 text-sm">
          <div className="flex justify-between gap-4 text-muted">
            <dt>
              {rows.length} {rows.length === 1 ? "item" : "items"}
            </dt>
            <dd className="tabular-nums">{formatCurrency(totals.total, currency)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="font-semibold text-fg">Total</dt>
            <dd className="text-xl font-bold text-fg tabular-nums" aria-live="polite">
              {formatCurrency(totals.total, currency)}
            </dd>
          </div>
          {!totals.withinLimit && <p className="text-xs font-medium text-danger-text">This total is too large for one invoice.</p>}
          <p className="text-xs text-muted">The server recalculates the total from the items when you save.</p>
        </dl>
      </fieldset>

      <div className="flex flex-col-reverse gap-2 border-t border-border pt-5 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onCancel} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {invoice ? "Save changes" : "Create invoice"}
        </Button>
      </div>
    </form>
  );
}

interface ItemRowFieldsProps {
  row: ItemRow;
  index: number;
  errors: ItemErrors;
  amount: string;
  canRemove: boolean;
  onChange: (patch: Partial<ItemRow>) => void;
  onRemove: () => void;
}

/** One line: a card with visible labels on phones, a table row under the shared header from md up. */
function ItemRowFields({ row, index, errors, amount, canRemove, onChange, onRemove }: ItemRowFieldsProps) {
  const n = index + 1;
  const errorId = (field: keyof ItemErrors) => (errors[field] ? `item-${row.key}-${field}-error` : undefined);
  const input = (field: "description" | "qty" | "unitPrice", label: string, { className, ...extra }: React.ComponentProps<"input">) => (
    <div className="min-w-0">
      <label htmlFor={`item-${row.key}-${field}`} className="mb-1 block text-xs font-medium text-muted md:sr-only">
        {label}
        <span className="sr-only"> for item {n}</span>
      </label>
      <input
        id={`item-${row.key}-${field}`}
        name={`item-${row.key}-${field}`}
        value={row[field]}
        onChange={(e) => onChange({ [field]: e.target.value })}
        aria-invalid={errors[field] ? true : undefined}
        aria-describedby={errorId(field)}
        {...extra}
        className={cn(controlClass, "h-11", className)}
      />
      {errors[field] && (
        <p id={errorId(field)} className="mt-1 text-xs font-medium text-danger-text">
          {errors[field]}
        </p>
      )}
    </div>
  );

  return (
    <div className="grid grid-cols-2 gap-3 rounded-xl border border-border p-3 md:grid-cols-[minmax(0,1fr)_6rem_8rem_8rem_2.75rem] md:items-start md:rounded-none md:border-0 md:p-0">
      <div className="col-span-2 md:col-span-1">{input("description", "Description", { placeholder: "Logo design", autoComplete: "off", maxLength: 500 })}</div>
      {input("qty", "Qty", { type: "number", inputMode: "decimal", min: 0, step: "0.01", className: "tabular-nums" })}
      {input("unitPrice", "Unit price", { type: "number", inputMode: "decimal", min: 0, step: "0.01", placeholder: "0.00", className: "tabular-nums" })}
      <div className="flex h-11 items-center text-sm font-semibold text-fg tabular-nums md:justify-end">
        <span className="mr-auto text-xs font-medium text-muted md:hidden">Amount</span>
        {amount}
      </div>
      <div className="flex justify-end md:block">
        <IconButton label={`Remove item ${n}`} onClick={onRemove} disabled={!canRemove} className="hover:bg-danger-soft hover:text-danger-text">
          <Trash2 className="size-4.5" aria-hidden="true" />
        </IconButton>
      </div>
    </div>
  );
}

export function InvoiceFormSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <LoadingLabel>Loading form</LoadingLabel>
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
