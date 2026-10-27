"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileX, Lock } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { InvoiceForm, InvoiceFormSkeleton } from "@/components/invoices/invoice-form";
import { LinkButton } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/feedback";
import { api, isApiError } from "@/lib/api";
import { canEditInvoice } from "@/lib/invoices";
import { queryKeys, useMe } from "@/lib/queries";
import type { InvoiceDetail } from "@/lib/types";

export default function EditInvoicePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const me = useMe();
  const query = useQuery({
    queryKey: queryKeys.invoice(id),
    queryFn: ({ signal }) => api<{ invoice: InvoiceDetail }>(`/invoices/${id}`, { signal }),
  });
  const workspace = me.data?.workspace;
  const invoice = query.data?.invoice;

  let body: React.ReactNode;
  if (query.isPending || !me.data || !workspace) {
    body = (
      <div className="p-5 sm:p-6">
        <InvoiceFormSkeleton />
      </div>
    );
  } else if (query.isError) {
    body =
      isApiError(query.error, 404) || isApiError(query.error, 400) ? (
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
      );
  } else if (!canEditInvoice(workspace.role, me.data.user.id, query.data.invoice)) {
    body = (
      <EmptyState
        icon={Lock}
        title={query.data.invoice.status === "paid" ? "This invoice is paid" : "You can't edit this invoice"}
        action={
          <LinkButton href={`/invoices/${id}`} variant="secondary">
            View invoice
          </LinkButton>
        }
      >
        {query.data.invoice.status === "paid"
          ? "Paid invoices are locked so the client's history stays accurate."
          : "Only the deal owner, project managers and admins can change it."}
      </EmptyState>
    );
  } else {
    body = (
      <div className="p-5 sm:p-6">
        <InvoiceForm
          invoice={query.data.invoice}
          me={{ id: me.data.user.id, role: workspace.role }}
          onCancel={() => router.push(`/invoices/${id}`)}
          onDone={() => router.push(`/invoices/${id}`)}
        />
      </div>
    );
  }

  return (
    <>
      <title>{invoice ? `Edit ${invoice.number} · AI CRM` : "Edit invoice · AI CRM"}</title>
      <Link href={`/invoices/${id}`} className="mb-4 inline-flex h-10 items-center gap-1.5 rounded-lg pr-2 text-sm font-medium text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {invoice?.number ?? "Invoice"}
      </Link>
      <h1 className="mb-6 text-2xl font-bold tracking-tight text-fg sm:text-3xl">{invoice ? `Edit ${invoice.number}` : "Edit invoice"}</h1>
      <div className="glass rounded-2xl">{body}</div>
    </>
  );
}
