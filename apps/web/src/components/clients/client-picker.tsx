"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Input, Select } from "@/components/ui/field";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queries";
import type { Client, Page } from "@/lib/types";

export interface ClientPickerProps {
  id: string;
  name: string;
  value: string;
  /** Label for the selected client when it is not in the current search results. */
  currentName: string | undefined;
  onChange: (clientId: string) => void;
  "aria-invalid": boolean | undefined;
  "aria-describedby": string | undefined;
  required: boolean | undefined;
}

/** A search box that narrows a native select, so it stays simple on mobile and with a keyboard. */
export function ClientPicker({ id, name, value, currentName, onChange, ...aria }: ClientPickerProps) {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(value && currentName ? { id: value, name: currentName } : null);

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const query = useQuery({
    queryKey: queryKeys.clients({ q, limit: 50, picker: true }),
    queryFn: ({ signal }) => api<{ clients: Client[] } & Page>("/clients", { query: { search: q, limit: 50 }, signal }),
    placeholderData: keepPreviousData,
  });
  const clients = query.data?.clients ?? [];
  const label = (c: Client) => (c.company ? `${c.name} · ${c.company}` : c.name);

  if (query.data && query.data.total === 0 && q === "") {
    return (
      <p id={id} className="rounded-xl border border-dashed border-border px-3.5 py-3 text-sm text-muted">
        No clients yet.{" "}
        <Link href="/clients" className="font-semibold text-primary-text underline-offset-2 hover:underline">
          Add a client
        </Link>{" "}
        first.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-subtle" aria-hidden="true" />
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search clients"
          aria-label="Search clients"
          aria-controls={id}
          className="h-10 pl-9 [&::-webkit-search-cancel-button]:hidden"
        />
      </div>
      <Select
        id={id}
        name={name}
        value={value}
        onChange={(e) => {
          const c = clients.find((x) => x.id === e.target.value);
          setPicked(c ? { id: c.id, name: label(c) } : null);
          onChange(e.target.value);
        }}
        aria-busy={query.isFetching}
        {...aria}
      >
        <option value="">{query.isPending ? "Loading clients…" : clients.length === 0 ? "No matching clients" : "Choose a client"}</option>
        {picked && !clients.some((c) => c.id === picked.id) && <option value={picked.id}>{picked.name}</option>}
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {label(c)}
          </option>
        ))}
      </Select>
    </div>
  );
}
