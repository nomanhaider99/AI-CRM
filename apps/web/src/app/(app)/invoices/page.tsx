"use client";

import type { InvoiceStatus } from "@crm/shared";
import { INVOICE_STATUSES } from "@crm/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, FileText, Plus, Search, SearchX, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { InvoiceStatusBadge } from "@/components/invoices/invoice-status-badge";
import { Button, LinkButton } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingLabel, Skeleton } from "@/components/ui/feedback";
import { controlClass } from "@/components/ui/field";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatCurrency, formatDay } from "@/lib/format";
import { INVOICE_STATUS_LABELS } from "@/lib/invoices";
import { queryKeys } from "@/lib/queries";
import type { Client, Invoice, Page } from "@/lib/types";

const PAGE_SIZE = 20;
const isStatus = (v: string | null): v is InvoiceStatus => INVOICE_STATUSES.includes(v as InvoiceStatus);
const COLUMNS = "md:grid-cols-[7.5rem_minmax(0,2fr)_7rem_7rem_6.5rem_minmax(0,1fr)]";

export default function InvoicesPage() {
  // Filters live in the URL (?q=&status=&clientId=&page=) so they survive reloads, back/forward and sharing.
  return (
    <Suspense>
      <InvoicesView />
    </Suspense>
  );
}

function InvoicesView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const q = params.get("q") ?? "";
  const statusParam = params.get("status");
  const status = isStatus(statusParam) ? statusParam : undefined;
  const clientId = params.get("clientId") ?? undefined;
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [search, setSearch] = useState(q);

  const setParams = (next: { q?: string; status?: InvoiceStatus | undefined; clientId?: string | undefined; page?: number }) => {
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined || value === "" || (key === "page" && value === 1)) merged.delete(key);
      else merged.set(key, String(value));
    }
    const qs = merged.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  // Debounce typing into the URL (and so into the query).
  useEffect(() => {
    if (search.trim() === q) return;
    const t = setTimeout(() => setParams({ q: search.trim(), page: 1 }), 300);
    return () => clearTimeout(t);
    // setParams is recreated each render; the inputs that matter are listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, q]);

  const query = useQuery({
    queryKey: queryKeys.invoices({ q, status, clientId, page }),
    queryFn: ({ signal }) =>
      api<{ invoices: Invoice[] } & Page>("/invoices", {
        query: { search: q, status, clientId, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE },
        signal,
      }),
    placeholderData: keepPreviousData,
  });
  // Name for the client filter chip; the list rows carry it too, but the list may be empty.
  const client = useQuery({
    queryKey: queryKeys.client(clientId ?? ""),
    queryFn: ({ signal }) => api<{ client: Client }>(`/clients/${clientId}`, { signal }),
    enabled: clientId !== undefined,
  });

  const filtered = q !== "" || status !== undefined || clientId !== undefined;
  const total = query.data?.total ?? 0;
  const first = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);
  const newHref = clientId ? `/invoices/new?clientId=${clientId}` : "/invoices/new";
  const clearFilters = () => {
    setSearch("");
    setParams({ q: "", status: undefined, clientId: undefined, page: 1 });
  };

  return (
    <>
      <title>Invoices · AI CRM</title>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-fg sm:text-3xl">Invoices</h1>
          <p className="mt-1 text-sm text-muted" aria-live="polite">
            {query.data ? `${total} ${filtered ? "matching" : "in this workspace"}` : " "}
          </p>
        </div>
        <LinkButton href={newHref}>
          <Plus className="size-4.5" aria-hidden="true" />
          New invoice
        </LinkButton>
      </div>

      <div className="glass mb-4 space-y-3 rounded-2xl p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4.5 -translate-y-1/2 text-subtle" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search number, client or company"
              aria-label="Search invoices"
              className={cn(controlClass, "h-11 pr-11 pl-10 [&::-webkit-search-cancel-button]:hidden")}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-muted hover:text-fg"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            )}
          </div>
          <div role="group" aria-label="Filter by status" className="flex gap-1 overflow-x-auto">
            {[undefined, ...INVOICE_STATUSES].map((s) => (
              <button
                key={s ?? "all"}
                type="button"
                aria-pressed={status === s}
                onClick={() => setParams({ status: s, page: 1 })}
                className={cn(
                  "h-10 shrink-0 rounded-xl px-3.5 text-sm font-medium transition-colors duration-150",
                  status === s ? "bg-primary text-on-primary shadow-sm" : "text-muted hover:bg-primary-soft hover:text-fg",
                )}
              >
                {s ? INVOICE_STATUS_LABELS[s] : "All"}
              </button>
            ))}
          </div>
        </div>
        {clientId && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted">Client:</span>
            <span className="inline-flex h-9 items-center gap-1 rounded-full bg-primary-soft pr-1 pl-3 font-medium text-primary-text">
              <span className="max-w-56 truncate">{client.data?.client.name ?? (client.isError ? "Unknown client" : "Loading…")}</span>
              <button
                type="button"
                onClick={() => setParams({ clientId: undefined, page: 1 })}
                aria-label="Remove client filter"
                className="flex size-7 items-center justify-center rounded-full hover:bg-primary-soft"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </span>
          </div>
        )}
      </div>

      <section aria-label="Invoice list" aria-busy={query.isFetching} className="glass overflow-hidden rounded-2xl">
        {query.isPending ? (
          <ListSkeleton />
        ) : query.isError ? (
          <ErrorState title="Couldn't load invoices" error={query.error} onRetry={() => query.refetch()} retrying={query.isFetching} />
        ) : query.data.invoices.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={SearchX}
              title="No invoices match"
              action={
                <Button variant="secondary" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            >
              Try another number or client name, or a different status.
            </EmptyState>
          ) : (
            <EmptyState
              icon={FileText}
              title="No invoices yet"
              action={
                <LinkButton href="/invoices/new">
                  <Plus className="size-4.5" aria-hidden="true" />
                  Create your first invoice
                </LinkButton>
              }
            >
              Bill a client with line items; totals are worked out for you and paid invoices land in the client's history.
            </EmptyState>
          )
        ) : (
          <>
            <div className={cn("hidden gap-4 border-b border-border px-5 py-3 text-xs font-semibold tracking-wide text-muted uppercase md:grid", COLUMNS)}>
              <span>Number</span>
              <span>Client</span>
              <span>Issued</span>
              <span>Due</span>
              <span>Status</span>
              <span className="text-right">Total</span>
            </div>
            <ul className={cn("divide-y divide-border transition-opacity duration-150", query.isPlaceholderData && "opacity-60")}>
              {query.data.invoices.map((inv) => (
                <li key={inv.id}>
                  <InvoiceRow invoice={inv} />
                </li>
              ))}
            </ul>
            {total > PAGE_SIZE && (
              <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 sm:px-5">
                <p className="text-sm text-muted">
                  <span className="font-semibold text-fg tabular-nums">
                    {first}–{last}
                  </span>{" "}
                  of <span className="tabular-nums">{total}</span>
                </p>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setParams({ page: page - 1 })}>
                    <ChevronLeft className="size-4" aria-hidden="true" />
                    Previous
                  </Button>
                  <Button variant="secondary" size="sm" disabled={last >= total} onClick={() => setParams({ page: page + 1 })}>
                    Next
                    <ChevronRight className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </nav>
            )}
          </>
        )}
      </section>
    </>
  );
}

function InvoiceRow({ invoice: inv }: { invoice: Invoice }) {
  return (
    <Link
      href={`/invoices/${inv.id}`}
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3.5 transition-colors duration-150 hover:bg-primary-soft focus-visible:-outline-offset-2 sm:px-5",
        COLUMNS,
      )}
    >
      <span className="font-semibold text-fg tabular-nums">{inv.number}</span>
      <span className="text-right font-semibold text-fg tabular-nums md:hidden">{formatCurrency(inv.total, inv.currency)}</span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-fg md:text-base">{inv.clientName}</span>
        <span className="block truncate text-sm text-muted">{inv.clientCompany ?? inv.dealTitle ?? ""}</span>
      </span>
      <span className="text-right md:hidden">
        <InvoiceStatusBadge invoice={inv} />
      </span>
      <span className="hidden text-sm text-muted tabular-nums md:block">{formatDay(inv.issueDate)}</span>
      <span className="hidden text-sm text-muted tabular-nums md:block">{inv.dueDate ? formatDay(inv.dueDate) : "—"}</span>
      <span className="hidden md:block">
        <InvoiceStatusBadge invoice={inv} />
      </span>
      <span className="hidden text-right font-semibold text-fg tabular-nums md:block">{formatCurrency(inv.total, inv.currency)}</span>
    </Link>
  );
}

function ListSkeleton() {
  return (
    <div className="divide-y divide-border">
      <LoadingLabel>Loading invoices</LoadingLabel>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <Skeleton className="h-4 w-20" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}
