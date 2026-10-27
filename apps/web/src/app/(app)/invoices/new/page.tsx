"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { InvoiceForm, InvoiceFormSkeleton } from "@/components/invoices/invoice-form";
import { api } from "@/lib/api";
import { queryKeys, useMe } from "@/lib/queries";
import type { Client } from "@/lib/types";

export default function NewInvoicePage() {
  return (
    <Suspense>
      <NewInvoice />
    </Suspense>
  );
}

function NewInvoice() {
  const router = useRouter();
  const params = useSearchParams();
  const me = useMe();
  // ?clientId= preselects the client (the "New invoice" button on a client page).
  const clientId = params.get("clientId") ?? undefined;
  const client = useQuery({
    queryKey: queryKeys.client(clientId ?? ""),
    queryFn: ({ signal }) => api<{ client: Client }>(`/clients/${clientId}`, { signal }),
    enabled: clientId !== undefined,
  });
  const back = clientId ? `/clients/${clientId}` : "/invoices";
  const ready = me.data?.workspace && (clientId === undefined || !client.isPending);

  return (
    <>
      <title>New invoice · AI CRM</title>
      <Link href={back} className="mb-4 inline-flex h-10 items-center gap-1.5 rounded-lg pr-2 text-sm font-medium text-muted hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {clientId ? (client.data?.client.name ?? "Client") : "Invoices"}
      </Link>
      <h1 className="mb-6 text-2xl font-bold tracking-tight text-fg sm:text-3xl">New invoice</h1>
      <div className="glass rounded-2xl p-5 sm:p-6">
        {ready ? (
          <InvoiceForm
            me={{ id: me.data!.user.id, role: me.data!.workspace!.role }}
            // An unknown or foreign client id just leaves the picker empty.
            defaultClientId={client.data ? clientId : undefined}
            defaultClientName={client.data?.client.name}
            onCancel={() => router.push(back)}
            onDone={(inv) => router.push(`/invoices/${inv.id}`)}
          />
        ) : (
          <InvoiceFormSkeleton />
        )}
      </div>
    </>
  );
}
