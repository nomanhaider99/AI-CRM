"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { Deal, Me, Member, Stage } from "./types";

export const queryKeys = {
  me: ["me"] as const,
  members: ["members"] as const,
  clients: (params: Record<string, unknown>) => ["clients", params] as const,
  clientsAll: ["clients"] as const,
  client: (id: string) => ["client", id] as const,
  events: (clientId: string) => ["client", clientId, "events"] as const,
  stages: ["stages"] as const,
  deals: ["deals"] as const,
};

export const useMe = () => useQuery({ queryKey: queryKeys.me, queryFn: ({ signal }) => api<Me>("/auth/me", { signal }) });

/** Workspace members, for owner names and pickers. */
export function useMembers(enabled = true) {
  const query = useQuery({
    queryKey: queryKeys.members,
    queryFn: ({ signal }) => api<{ members: Member[] }>("/members", { signal }),
    staleTime: 60_000,
    enabled,
  });
  const byId = new Map((query.data?.members ?? []).map((m) => [m.userId, m]));
  return { ...query, members: query.data?.members ?? [], byId };
}

/** Pipeline stages in board order; they rarely change. */
export const useStages = () =>
  useQuery({
    queryKey: queryKeys.stages,
    queryFn: ({ signal }) => api<{ stages: Stage[] }>("/stages", { signal }),
    staleTime: 5 * 60_000,
  });

/** Every deal the caller can see (sellers: own + unassigned); the board filters on the client. */
export const useDeals = () =>
  useQuery({ queryKey: queryKeys.deals, queryFn: ({ signal }) => api<{ deals: Deal[] }>("/deals", { signal }) });
