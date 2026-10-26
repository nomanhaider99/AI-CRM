"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { Me, Member } from "./types";

export const queryKeys = {
  me: ["me"] as const,
  members: ["members"] as const,
  clients: (params: Record<string, unknown>) => ["clients", params] as const,
  clientsAll: ["clients"] as const,
  client: (id: string) => ["client", id] as const,
  events: (clientId: string) => ["client", clientId, "events"] as const,
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
