"use client";

import type { ClientStatus } from "@crm/shared";
import { CLIENT_STATUSES } from "@crm/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, Search, SearchX, Users, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ClientForm } from "@/components/clients/client-form";
import { Avatar, STATUS_LABELS, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState, LoadingLabel, Skeleton } from "@/components/ui/feedback";
import { controlClass } from "@/components/ui/field";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { queryKeys, useMe, useMembers } from "@/lib/queries";
import type { Client, Page } from "@/lib/types";

const PAGE_SIZE = 20;
const isStatus = (v: string | null): v is ClientStatus => CLIENT_STATUSES.includes(v as ClientStatus);

export default function ClientsPage() {
  // Filters live in the URL (?q=&status=&page=) so they survive reloads, back/forward and sharing.
  return (
    <Suspense>
      <ClientsView />
    </Suspense>
  );
}

function ClientsView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const me = useMe();
  const { byId: members } = useMembers();
  const [creating, setCreating] = useState(false);

  const q = params.get("q") ?? "";
  const statusParam = params.get("status");
  const status = isStatus(statusParam) ? statusParam : undefined;
  const page = Math.max(1, Number(params.get("page")) || 1);
  const [search, setSearch] = useState(q);

  const setParams = (next: { q?: string; status?: ClientStatus | undefined; page?: number }) => {
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
    queryKey: queryKeys.clients({ q, status, page }),
    queryFn: ({ signal }) =>
      api<{ clients: Client[] } & Page>("/clients", { query: { search: q, status, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }, signal }),
    placeholderData: keepPreviousData,
  });

  const filtered = q !== "" || status !== undefined;
  const total = query.data?.total ?? 0;
  const first = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page * PAGE_SIZE, total);

  return (
    <>
      <title>Clients · AI CRM</title>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-fg sm:text-3xl">Clients</h1>
          <p className="mt-1 text-sm text-muted" aria-live="polite">
            {query.data ? `${total} ${filtered ? "matching" : "in this workspace"}` : " "}
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4.5" aria-hidden="true" />
          New client
        </Button>
      </div>

      <div className="glass mb-4 flex flex-col gap-3 rounded-2xl p-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4.5 -translate-y-1/2 text-subtle" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, company or email"
            aria-label="Search clients"
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
          {[undefined, ...CLIENT_STATUSES].map((s) => (
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
              {s ? STATUS_LABELS[s] : "All"}
            </button>
          ))}
        </div>
      </div>

      <section aria-label="Client list" aria-busy={query.isFetching} className="glass overflow-hidden rounded-2xl">
        {query.isPending ? (
          <ListSkeleton />
        ) : query.isError ? (
          <ErrorState title="Couldn't load clients" error={query.error} onRetry={() => query.refetch()} retrying={query.isFetching} />
        ) : query.data.clients.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={SearchX}
              title="No clients match"
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch("");
                    setParams({ q: "", status: undefined, page: 1 });
                  }}
                >
                  Clear filters
                </Button>
              }
            >
              Try a different name, company or email, or another status.
            </EmptyState>
          ) : (
            <EmptyState
              icon={Users}
              title="No clients yet"
              action={
                <Button onClick={() => setCreating(true)}>
                  <Plus className="size-4.5" aria-hidden="true" />
                  Add your first client
                </Button>
              }
            >
              Add a client to start their history: sales, calls, notes and invoices in one timeline.
            </EmptyState>
          )
        ) : (
          <>
            <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,2fr)_7rem_minmax(0,1.3fr)_7rem] gap-4 border-b border-border px-5 py-3 text-xs font-semibold tracking-wide text-muted uppercase md:grid">
              <span>Client</span>
              <span>Contact</span>
              <span>Status</span>
              <span>Owner</span>
              <span className="text-right">Added</span>
            </div>
            <ul className={cn("divide-y divide-border transition-opacity duration-150", query.isPlaceholderData && "opacity-60")}>
              {query.data.clients.map((c) => (
                <li key={c.id}>
                  <ClientRow client={c} ownerName={c.ownerId ? members.get(c.ownerId)?.name : undefined} />
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

      <Dialog open={creating} onClose={() => setCreating(false)} title="New client" description="Only the name is required; add the rest any time.">
        {me.data && (
          <ClientForm
            currentUserId={me.data.user.id}
            onCancel={() => setCreating(false)}
            onDone={(c) => {
              setCreating(false);
              router.push(`/clients/${c.id}`);
            }}
          />
        )}
      </Dialog>
    </>
  );
}

function ClientRow({ client: c, ownerName }: { client: Client; ownerName: string | undefined }) {
  return (
    <Link
      href={`/clients/${c.id}`}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3.5 transition-colors duration-150 hover:bg-primary-soft focus-visible:-outline-offset-2 sm:px-5 md:grid-cols-[minmax(0,2.2fr)_minmax(0,2fr)_7rem_minmax(0,1.3fr)_7rem]"
    >
      <span className="flex min-w-0 items-center gap-3">
        <Avatar name={c.name} />
        <span className="min-w-0">
          <span className="block truncate font-semibold text-fg">{c.name}</span>
          <span className="block truncate text-sm text-muted">{c.company ?? "No company"}</span>
        </span>
      </span>
      <span className="hidden min-w-0 text-sm md:block">
        <span className="block truncate text-fg">{c.email ?? "—"}</span>
        <span className="block truncate text-muted">{c.phone ?? ""}</span>
      </span>
      <span>
        <StatusBadge status={c.status} />
      </span>
      <span className="hidden truncate text-sm text-muted md:block">{c.ownerId ? (ownerName ?? "…") : "Unassigned"}</span>
      <span className="hidden text-right text-sm text-muted tabular-nums md:block">{formatDate(c.createdAt)}</span>
    </Link>
  );
}

function ListSkeleton() {
  return (
    <div className="divide-y divide-border">
      <LoadingLabel>Loading clients</LoadingLabel>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-4">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}
