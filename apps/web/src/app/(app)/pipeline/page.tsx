"use client";

import { can } from "@crm/shared";
import { KanbanSquare, Plus, Search, SearchX, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Board } from "@/components/pipeline/board";
import type { CardInfo } from "@/components/pipeline/deal-card";
import { DealDetails } from "@/components/pipeline/deal-details";
import { DealForm } from "@/components/pipeline/deal-form";
import { useMoveDeal } from "@/components/pipeline/use-deal-mutations";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, ErrorState, LoadingLabel, Skeleton } from "@/components/ui/feedback";
import { Select, controlClass } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import type { ToastMessage } from "@/components/ui/toast";
import { Toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { canChangeDeal, matchesFilter } from "@/lib/pipeline";
import { useDeals, useMe, useMembers, useStages } from "@/lib/queries";
import type { Deal } from "@/lib/types";

export default function PipelinePage() {
  // Filters live in the URL (?owner=&q=) so they survive reloads, back/forward and sharing.
  return (
    <Suspense>
      <PipelineView />
    </Suspense>
  );
}

function PipelineView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const me = useMe();
  const { members, byId: memberById } = useMembers();
  const stagesQuery = useStages();
  const dealsQuery = useDeals();

  const owner = params.get("owner") ?? "";
  const q = params.get("q") ?? "";
  const [search, setSearch] = useState(q);
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const setParams = (next: { owner?: string; q?: string }) => {
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (!value) merged.delete(key);
      else merged.set(key, value);
    }
    const qs = merged.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  useEffect(() => {
    if (search.trim() === q) return;
    const t = setTimeout(() => setParams({ q: search.trim() }), 250);
    return () => clearTimeout(t);
    // setParams is recreated each render; the inputs that matter are listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, q]);

  const move = useMoveDeal((deal, error) =>
    setToast({ id: Date.now(), tone: "danger", text: `Couldn't move "${deal.title}". ${error.message.replace(/\.?$/, ".")} It's back where it was.` }),
  );

  const user = me.data?.user;
  const role = me.data?.workspace?.role;
  if (!user || !role) return null; // AppShell shows the skeleton until the workspace is known.
  const actor = { id: user.id, role };
  const isManager = can(role, "deals:read_any");

  const ownerLabel = (d: Deal) => (d.ownerId ? memberById.get(d.ownerId)?.name : "Unassigned");
  const cardInfo = (d: Deal): CardInfo => ({
    ownerLabel: ownerLabel(d),
    lockReason: canChangeDeal(role, user.id, d)
      ? undefined
      : d.ownerId
        ? `Only ${ownerLabel(d) ?? "its owner"} or a manager can change this deal.`
        : "Unassigned deals can only be changed by a manager.",
  });

  const filter = { owner, q };
  const filtered = owner !== "" || q !== "";
  const deals = dealsQuery.data?.deals ?? [];
  const shown = deals.filter((d) => matchesFilter(d, filter, user.id));
  const openDeal = openId ? deals.find((d) => d.id === openId) : undefined;
  const clearFilters = () => {
    setSearch("");
    setParams({ owner: "", q: "" });
  };

  return (
    <>
      <title>Pipeline · AI CRM</title>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-fg sm:text-3xl">Pipeline</h1>
          <p className="mt-1 text-sm text-muted" aria-live="polite">
            {dealsQuery.data
              ? `${shown.length} ${shown.length === 1 ? "deal" : "deals"}${filtered ? " matching" : isManager ? "" : " (yours and unassigned)"}`
              : " "}
          </p>
        </div>
        <Button onClick={() => setCreatingIn("")} disabled={!stagesQuery.data?.stages.length}>
          <Plus className="size-4.5" aria-hidden="true" />
          New deal
        </Button>
      </div>

      <div className="glass mb-4 flex flex-col gap-3 rounded-2xl p-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4.5 -translate-y-1/2 text-subtle" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search deal or client"
            aria-label="Search deals"
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
        <Select aria-label="Filter by owner" value={owner} onChange={(e) => setParams({ owner: e.target.value })} className="sm:w-56">
          <option value="">{isManager ? "All owners" : "All deals"}</option>
          <option value="me">My deals</option>
          <option value="unassigned">Unassigned</option>
          {isManager &&
            members
              .filter((m) => m.userId !== user.id)
              .map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
        </Select>
      </div>

      {stagesQuery.isPending || dealsQuery.isPending ? (
        <BoardSkeleton />
      ) : stagesQuery.isError || dealsQuery.isError ? (
        <div className="glass rounded-2xl">
          <ErrorState
            title="Couldn't load the pipeline"
            error={stagesQuery.error ?? dealsQuery.error}
            onRetry={() => {
              void stagesQuery.refetch();
              void dealsQuery.refetch();
            }}
            retrying={stagesQuery.isFetching || dealsQuery.isFetching}
          />
        </div>
      ) : stagesQuery.data.stages.length === 0 ? (
        <div className="glass rounded-2xl">
          <EmptyState icon={KanbanSquare} title="No pipeline stages">
            This workspace has no stages yet, so there is nowhere to put deals.
          </EmptyState>
        </div>
      ) : (
        <>
          {deals.length === 0 ? (
            <div className="glass mb-4 rounded-2xl">
              <EmptyState
                icon={KanbanSquare}
                title={isManager ? "No deals yet" : "No deals for you yet"}
                className="py-8"
                action={
                  <Button onClick={() => setCreatingIn("")}>
                    <Plus className="size-4.5" aria-hidden="true" />
                    Create your first deal
                  </Button>
                }
              >
                Add a deal for a client, then drag it across the stages as it progresses.
              </EmptyState>
            </div>
          ) : (
            filtered &&
            shown.length === 0 && (
              <div className="glass mb-4 rounded-2xl">
                <EmptyState
                  icon={SearchX}
                  title="No deals match"
                  className="py-8"
                  action={
                    <Button variant="secondary" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  }
                >
                  Try another search or owner.
                </EmptyState>
              </div>
            )
          )}
          <Board
            stages={stagesQuery.data.stages}
            deals={deals}
            isVisible={(d) => matchesFilter(d, filter, user.id)}
            cardInfo={cardInfo}
            onOpen={(d) => setOpenId(d.id)}
            onAdd={(stageId) => setCreatingIn(stageId)}
            onMove={move}
          />
        </>
      )}

      <Dialog open={creatingIn !== null} onClose={() => setCreatingIn(null)} title="New deal" description="Pick a client and a value; you can change everything later.">
        {stagesQuery.data && creatingIn !== null && (
          <DealForm
            stages={stagesQuery.data.stages}
            defaultStageId={creatingIn || undefined}
            me={actor}
            onCancel={() => setCreatingIn(null)}
            onDone={(d) => {
              setCreatingIn(null);
              setToast({ id: Date.now(), tone: "success", text: `"${d.title}" added to the board.` });
            }}
          />
        )}
      </Dialog>

      <Sheet open={openDeal !== undefined} onClose={() => setOpenId(null)} title={openDeal?.title ?? "Deal"} eyebrow="Deal">
        {openDeal && stagesQuery.data && (
          <DealDetails
            key={openDeal.id}
            deal={openDeal}
            stages={stagesQuery.data.stages}
            me={actor}
            onMove={move}
            onDeleted={(d) => {
              setOpenId(null);
              setToast({ id: Date.now(), tone: "success", text: `"${d.title}" deleted.` });
            }}
            {...cardInfo(openDeal)}
          />
        )}
      </Sheet>

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}

function BoardSkeleton() {
  return (
    <div className="-mx-4 flex gap-3 overflow-hidden px-4 pb-6 sm:-mx-6 sm:px-6" aria-busy="true">
      <LoadingLabel>Loading the pipeline</LoadingLabel>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="glass w-[min(20rem,calc(100vw-3rem))] shrink-0 space-y-2 rounded-2xl p-3 sm:w-72">
          <Skeleton className="mb-3 h-5 w-24" />
          {Array.from({ length: 3 - (i % 3) }, (_, j) => (
            <Skeleton key={j} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ))}
    </div>
  );
}
