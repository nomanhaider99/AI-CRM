"use client";

import type { Role } from "@crm/shared";
import { can } from "@crm/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, FileX, Pencil, Printer, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { InvoiceStatusBadge } from "@/components/invoices/invoice-status-badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert, EmptyState, ErrorState, LoadingLabel, Skeleton } from "@/components/ui/feedback";
import type { ToastMessage } from "@/components/ui/toast";
import { Toast } from "@/components/ui/toast";
import { api, isApiError } from "@/lib/api";
import { formatCurrency, formatDate, formatDay } from "@/lib/format";
import { canEditInvoice } from "@/lib/invoices";
import { queryKeys, useMe } from "@/lib/queries";
import type { InvoiceDetail } from "@/lib/types";

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const query = useQuery({
    queryKey: queryKeys.invoice(id),
    queryFn: ({ signal }) => api<{ invoice: InvoiceDetail }>(`/invoices/${id}`, { signal }),
  });

  const back = (
    <Link href="/invoices" className="inline-flex h-10 items-center gap-1.5 rounded-lg pr-2 text-sm font-medium text-muted hover:text-fg print:hidden">
      <ArrowLeft className="size-4" aria-hidden="true" />
      Invoices
    </Link>
  );

  if (query.isPending || !me.data?.workspace) {
    return (
      <>
        <div className="mb-4">{back}</div>
        <DetailSkeleton />
      </>
    );
  }

  // 404 (deleted, or another workspace's id) and 400 (malformed id) both mean "nothing here".
  if (query.isError) {
    const missing = isApiError(query.error, 404) || isApiError(query.error, 400);
    return (
      <>
        <div className="mb-4">{back}</div>
        <div className="glass rounded-2xl">
          {missing ? (
            <EmptyState
              icon={FileX}
              title="Invoice not found"
              action={
                <LinkButton href="/invoices" variant="secondary">
                  Back to invoices
                </LinkButton>
              }
            >
              It may have been deleted, or the link is wrong.
            </EmptyState>
          ) : (
            <ErrorState title="Couldn't load this invoice" error={query.error} onRetry={() => query.refetch()} retrying={query.isFetching} />
          )}
        </div>
      </>
    );
  }

  return (
    <InvoiceView
      invoice={query.data.invoice}
      back={back}
      workspaceName={me.data.workspace.name}
      me={{ id: me.data.user.id, role: me.data.workspace.role }}
    />
  );
}

interface InvoiceViewProps {
  invoice: InvoiceDetail;
  back: React.ReactNode;
  workspaceName: string;
  me: { id: string; role: Role };
}

function InvoiceView({ invoice, back, workspaceName, me }: InvoiceViewProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState<"pay" | "delete" | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const editable = canEditInvoice(me.role, me.id, invoice);
  const canDelete = can(me.role, "invoices:delete");

  const onSaved = (saved: InvoiceDetail, text: string) => {
    queryClient.setQueryData(queryKeys.invoice(saved.id), { invoice: saved });
    void queryClient.invalidateQueries({ queryKey: queryKeys.invoicesAll });
    void queryClient.invalidateQueries({ queryKey: queryKeys.events(saved.clientId) });
    setConfirm(null);
    setToast({ id: Date.now(), tone: "success", text });
  };
  const onFailed = (err: Error) => {
    setConfirm(null);
    setToast({ id: Date.now(), tone: "danger", text: err.message });
    // 409: someone else paid or changed it meanwhile; show the current state.
    if (isApiError(err, 409)) void queryClient.invalidateQueries({ queryKey: queryKeys.invoice(invoice.id) });
  };

  const pay = useMutation({
    mutationFn: () => api<{ invoice: InvoiceDetail }>(`/invoices/${invoice.id}/pay`, { method: "POST" }),
    onSuccess: ({ invoice: saved }) => onSaved(saved, `${saved.number} marked as paid`),
    onError: onFailed,
  });
  const send = useMutation({
    mutationFn: () => api<{ invoice: InvoiceDetail }>(`/invoices/${invoice.id}`, { method: "PATCH", body: { status: "sent" } }),
    onSuccess: ({ invoice: saved }) => onSaved(saved, `${saved.number} marked as sent`),
    onError: onFailed,
  });
  const remove = useMutation({
    mutationFn: () => api(`/invoices/${invoice.id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: queryKeys.invoice(invoice.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.invoicesAll });
      router.replace("/invoices");
    },
  });
  const busy = pay.isPending || send.isPending || remove.isPending;

  return (
    <>
      <title>{`${invoice.number} · AI CRM`}</title>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        {back}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden="true" />
            Print
          </Button>
          {editable && (
            <LinkButton href={`/invoices/${invoice.id}/edit`} variant="secondary" size="sm">
              <Pencil className="size-4" aria-hidden="true" />
              Edit
            </LinkButton>
          )}
          {editable && invoice.status === "draft" && (
            <Button variant="secondary" size="sm" onClick={() => send.mutate()} loading={send.isPending} disabled={busy}>
              <Send className="size-4" aria-hidden="true" />
              Mark as sent
            </Button>
          )}
          {editable && (
            <Button size="sm" onClick={() => setConfirm("pay")} disabled={busy}>
              <CheckCircle2 className="size-4" aria-hidden="true" />
              Mark as paid
            </Button>
          )}
          {canDelete && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirm("delete")}
              disabled={busy}
              className="hover:bg-danger-soft hover:text-danger-text"
              aria-label={`Delete ${invoice.number}`}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Delete</span>
            </Button>
          )}
        </div>
      </div>

      {invoice.status === "paid" && (
        <p className="mb-4 text-sm text-muted print:hidden">{canDelete ? "Paid invoices are locked; as an admin you can still delete it." : "Paid invoices are locked."}</p>
      )}
      {!editable && invoice.status !== "paid" && (
        <p className="mb-4 text-sm text-muted print:hidden">You can view this invoice; only its deal owner, project managers and admins can change it.</p>
      )}

      <article aria-labelledby="invoice-title" className="invoice-sheet glass mx-auto max-w-4xl rounded-2xl p-5 sm:p-10">
        <header className="flex flex-col gap-6 border-b border-border pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-lg font-bold tracking-tight [overflow-wrap:anywhere] text-fg">{workspaceName}</p>
            <p className="mt-1 text-sm text-muted">Issued {formatDay(invoice.issueDate)}</p>
          </div>
          <div className="sm:text-right">
            <p className="text-xs font-semibold tracking-[0.2em] text-muted uppercase">Invoice</p>
            <h1 id="invoice-title" className="mt-1 text-3xl font-bold tracking-tight text-fg tabular-nums">
              {invoice.number}
            </h1>
            <InvoiceStatusBadge invoice={invoice} className="mt-2" />
          </div>
        </header>

        <dl className="grid gap-6 border-b border-border py-6 text-sm sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <dt className="text-xs font-semibold tracking-wide text-muted uppercase">Bill to</dt>
            <dd className="mt-1.5 space-y-0.5 [overflow-wrap:anywhere]">
              <Link href={`/clients/${invoice.clientId}`} className="font-semibold text-fg underline-offset-4 hover:underline print:no-underline">
                {invoice.clientName}
              </Link>
              {invoice.clientCompany && <p className="text-fg">{invoice.clientCompany}</p>}
              {invoice.clientEmail && <p className="text-muted">{invoice.clientEmail}</p>}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold tracking-wide text-muted uppercase">Due</dt>
            <dd className="mt-1.5 font-medium text-fg tabular-nums">{invoice.dueDate ? formatDay(invoice.dueDate) : "On receipt"}</dd>
            {invoice.paidAt && (
              <>
                <dt className="mt-4 text-xs font-semibold tracking-wide text-muted uppercase">Paid</dt>
                <dd className="mt-1.5 font-medium text-fg tabular-nums">{formatDate(invoice.paidAt)}</dd>
              </>
            )}
          </div>
          <div>
            <dt className="text-xs font-semibold tracking-wide text-muted uppercase">Deal</dt>
            <dd className="mt-1.5 font-medium [overflow-wrap:anywhere] text-fg">{invoice.dealId ? (invoice.dealTitle ?? "Linked deal") : "—"}</dd>
          </div>
        </dl>

        <table className="w-full table-fixed border-collapse text-sm">
          <caption className="sr-only">Line items</caption>
          <thead>
            <tr className="border-b border-border text-left text-xs font-semibold tracking-wide text-muted uppercase">
              <th scope="col" className="py-3 pr-3">
                Description
              </th>
              <th scope="col" className="w-14 py-3 pr-3 text-right sm:w-20">
                Qty
              </th>
              <th scope="col" className="hidden w-28 py-3 pr-3 text-right sm:table-cell print:table-cell">
                Unit price
              </th>
              <th scope="col" className="w-28 py-3 text-right">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((item) => (
              <tr key={item.id} className="border-b border-border align-top break-inside-avoid">
                <td className="py-3 pr-3 [overflow-wrap:anywhere] text-fg">
                  {item.description}
                  <span className="mt-0.5 block text-xs text-muted tabular-nums sm:hidden print:hidden">
                    {formatCurrency(item.unitPrice, invoice.currency)} each
                  </span>
                </td>
                <td className="py-3 pr-3 text-right text-fg tabular-nums">{item.qty}</td>
                <td className="hidden py-3 pr-3 text-right text-fg tabular-nums sm:table-cell print:table-cell">
                  {formatCurrency(item.unitPrice, invoice.currency)}
                </td>
                <td className="py-3 text-right font-medium text-fg tabular-nums">{formatCurrency(item.amount, invoice.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="mt-6 ml-auto max-w-xs space-y-2 text-sm break-inside-avoid">
          <div className="flex justify-between gap-4 text-muted">
            <dt>Subtotal</dt>
            <dd className="tabular-nums">{formatCurrency(invoice.total, invoice.currency)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 border-t border-border pt-3">
            <dt className="font-semibold text-fg">Total ({invoice.currency})</dt>
            <dd className="text-2xl font-bold text-fg tabular-nums">{formatCurrency(invoice.total, invoice.currency)}</dd>
          </div>
          {invoice.status === "paid" && (
            <div className="flex justify-between gap-4 font-medium text-success-text">
              <dt>Amount due</dt>
              <dd className="tabular-nums">{formatCurrency(0, invoice.currency)}</dd>
            </div>
          )}
        </dl>
      </article>

      <Dialog
        open={confirm === "pay"}
        onClose={() => setConfirm(null)}
        title={`Mark ${invoice.number} as paid?`}
        description={`${formatCurrency(invoice.total, invoice.currency)} is added to ${invoice.clientName}'s history. Paid invoices can no longer be edited.`}
      >
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={() => setConfirm(null)} disabled={pay.isPending}>
            Cancel
          </Button>
          <Button onClick={() => pay.mutate()} loading={pay.isPending}>
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Mark as paid
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={confirm === "delete"}
        onClose={() => {
          setConfirm(null);
          remove.reset();
        }}
        title={`Delete ${invoice.number}?`}
        description="The invoice and its line items are removed. Entries already in the client's history stay. This can't be undone."
      >
        <div className="space-y-4">
          {remove.error && <Alert>{remove.error.message}</Alert>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setConfirm(null)} disabled={remove.isPending}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => remove.mutate()} loading={remove.isPending}>
              <Trash2 className="size-4" aria-hidden="true" />
              Delete invoice
            </Button>
          </div>
        </div>
      </Dialog>

      <div className="print:hidden">
        <Toast toast={toast} onDismiss={() => setToast(null)} />
      </div>
    </>
  );
}

function DetailSkeleton() {
  return (
    <div className="glass mx-auto max-w-4xl space-y-6 rounded-2xl p-5 sm:p-10" aria-busy="true">
      <LoadingLabel>Loading invoice</LoadingLabel>
      <div className="flex justify-between gap-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-9 w-32" />
      </div>
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="ml-auto h-10 w-48" />
    </div>
  );
}
