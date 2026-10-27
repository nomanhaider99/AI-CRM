"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, FileText, Plus } from "lucide-react";
import Link from "next/link";
import { InvoiceStatusBadge } from "@/components/invoices/invoice-status-badge";
import { LinkButton } from "@/components/ui/button";
import { ErrorState, LoadingLabel, Skeleton } from "@/components/ui/feedback";
import { api } from "@/lib/api";
import { formatCurrency, formatDay } from "@/lib/format";
import { queryKeys } from "@/lib/queries";
import type { Invoice, Page } from "@/lib/types";

const LIMIT = 5;

/** The client's latest invoices on the client page, with a link to the filtered Invoices list. */
export function ClientInvoices({ clientId }: { clientId: string }) {
  const query = useQuery({
    queryKey: queryKeys.invoices({ clientId, page: 1, limit: LIMIT }),
    queryFn: ({ signal }) => api<{ invoices: Invoice[] } & Page>("/invoices", { query: { clientId, limit: LIMIT }, signal }),
  });
  const total = query.data?.total ?? 0;

  return (
    <section aria-labelledby="client-invoices-heading" className="glass overflow-hidden rounded-2xl">
      <header className="flex items-center justify-between gap-3 border-b border-border py-2 pr-2 pl-4 sm:pl-5">
        <h2 id="client-invoices-heading" className="flex items-center gap-2 font-semibold text-fg">
          <FileText className="size-5 text-muted" aria-hidden="true" />
          Invoices
          {total > 0 && <span className="text-sm font-normal text-muted tabular-nums">({total})</span>}
        </h2>
        <LinkButton href={`/invoices/new?clientId=${clientId}`} variant="ghost" size="sm">
          <Plus className="size-4" aria-hidden="true" />
          New
        </LinkButton>
      </header>

      {query.isPending ? (
        <div className="space-y-3 p-4" aria-busy="true">
          <LoadingLabel>Loading invoices</LoadingLabel>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : query.isError ? (
        <ErrorState title="Couldn't load invoices" error={query.error} onRetry={() => query.refetch()} retrying={query.isFetching} className="py-8" />
      ) : query.data.invoices.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">No invoices for this client yet.</p>
      ) : (
        <>
          <ul className="divide-y divide-border">
            {query.data.invoices.map((inv) => (
              <li key={inv.id}>
                <Link
                  href={`/invoices/${inv.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-primary-soft focus-visible:-outline-offset-2 sm:px-5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-fg tabular-nums">{inv.number}</span>
                    <span className="block text-xs text-muted tabular-nums">{formatDay(inv.issueDate)}</span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <span className="text-sm font-semibold text-fg tabular-nums">{formatCurrency(inv.total, inv.currency)}</span>
                    <InvoiceStatusBadge invoice={inv} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {total > LIMIT && (
            <Link
              href={`/invoices?clientId=${clientId}`}
              className="flex h-11 items-center justify-center gap-1.5 border-t border-border text-sm font-semibold text-primary-text hover:bg-primary-soft"
            >
              View all {total}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          )}
        </>
      )}
    </section>
  );
}
