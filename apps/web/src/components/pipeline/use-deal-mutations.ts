"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { api } from "@/lib/api";
import { applyColumns, locate, moveInColumns, toColumns } from "@/lib/pipeline";
import { queryKeys } from "@/lib/queries";
import type { Deal, Stage } from "@/lib/types";

type DealsData = { deals: Deal[] };
type StagesData = { stages: Stage[] };

interface MoveVars {
  deal: Deal;
  stageId: string;
  position: number;
  /** Where the deal was before the optimistic update, to put it back if the API refuses. */
  from: { stageId: string; index: number };
}

const MOVE_KEY = ["moveDeal"] as const;

/**
 * Moves a deal optimistically: the cache is updated before the request, and on failure only this
 * deal is put back (other moves made meanwhile stay). The board refetches once no move is in flight.
 */
export function useMoveDeal(onFailed: (deal: Deal, error: Error) => void) {
  const queryClient = useQueryClient();

  const rewrite = useCallback(
    (fn: (deals: Deal[], stages: Stage[]) => Deal[]) => {
      const stages = queryClient.getQueryData<StagesData>(queryKeys.stages)?.stages;
      if (!stages) return;
      queryClient.setQueryData<DealsData>(queryKeys.deals, (data) => data && { deals: fn(data.deals, stages) });
    },
    [queryClient],
  );

  const { mutate } = useMutation({
    mutationKey: MOVE_KEY,
    mutationFn: ({ deal, stageId, position }: MoveVars) =>
      api<{ deal: Deal }>(`/deals/${deal.id}/move`, { method: "POST", body: { stageId, position } }),
    onError: (error, { deal, from }) => {
      rewrite((deals, stages) => applyColumns(deals, moveInColumns(toColumns(stages, deals), deal.id, from.stageId, from.index)));
      onFailed(deal, error);
    },
    onSettled: () => {
      // This mutation still counts as pending here; refetch only when it is the last one.
      if (queryClient.isMutating({ mutationKey: MOVE_KEY }) <= 1) void queryClient.invalidateQueries({ queryKey: queryKeys.deals });
    },
  });

  /** Moves a deal to `index` in `stageId` (past the end = last). Resolves once the cache shows the move. */
  return useCallback(
    async (dealId: string, stageId: string, index: number) => {
      // A refetch landing after the optimistic write would undo it on screen.
      await queryClient.cancelQueries({ queryKey: queryKeys.deals });
      const deals = queryClient.getQueryData<DealsData>(queryKeys.deals)?.deals;
      const stages = queryClient.getQueryData<StagesData>(queryKeys.stages)?.stages;
      const deal = deals?.find((d) => d.id === dealId);
      if (!deals || !stages || !deal) return;

      const columns = toColumns(stages, deals);
      const from = locate(columns, dealId);
      const next = moveInColumns(columns, dealId, stageId, index);
      const to = locate(next, dealId);
      if (!from || !to || (from.stageId === to.stageId && from.index === to.index)) return;

      queryClient.setQueryData<DealsData>(queryKeys.deals, { deals: applyColumns(deals, next) });
      mutate({ deal, stageId: to.stageId, position: to.index, from });
    },
    [queryClient, mutate],
  );
}

/** Removes a deal; the cache drops it at once and the board refetches to renumber positions. */
export function useDeleteDeal(onDone: (deal: Deal) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (deal: Deal) => api<void>(`/deals/${deal.id}`, { method: "DELETE" }),
    onSuccess: (_, deal) => {
      queryClient.setQueryData<DealsData>(queryKeys.deals, (data) => data && { deals: data.deals.filter((d) => d.id !== deal.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.deals });
      onDone(deal);
    },
  });
}
