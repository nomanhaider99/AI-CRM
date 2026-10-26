"use client";

import { can } from "@crm/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Mail, Pencil, Phone, Trash2, UserRound, UserX } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { ClientForm } from "@/components/clients/client-form";
import { Timeline } from "@/components/clients/timeline";
import { Avatar, StatusBadge } from "@/components/ui/badge";
import { Button, LinkButton } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert, EmptyState, ErrorState, LoadingLabel, Skeleton } from "@/components/ui/feedback";
import { api, isApiError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { queryKeys, useMe, useMembers } from "@/lib/queries";
import type { Client } from "@/lib/types";

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const query = useQuery({
    queryKey: queryKeys.client(id),
    queryFn: ({ signal }) => api<{ client: Client }>(`/clients/${id}`, { signal }),
  });

  const back = (
    <Link href="/clients" className="mb-4 inline-flex h-10 items-center gap-1.5 rounded-lg pr-2 text-sm font-medium text-muted hover:text-fg">
      <ArrowLeft className="size-4" aria-hidden="true" />
      Clients
    </Link>
  );

  if (query.isPending || !me.data) {
    return (
      <>
        {back}
        <DetailSkeleton />
      </>
    );
  }

  // 404 (gone, or another workspace's id) and 400 (malformed id) both mean "nothing here".
  if (query.isError) {
    const missing = isApiError(query.error, 404) || isApiError(query.error, 400);
    return (
      <>
        {back}
        <div className="glass rounded-2xl">
          {missing ? (
            <EmptyState
              icon={UserX}
              title="Client not found"
              action={
                <LinkButton href="/clients" variant="secondary">
                  Back to clients
                </LinkButton>
              }
            >
              It may have been deleted, or the link is wrong.
            </EmptyState>
          ) : (
            <ErrorState title="Couldn't load this client" error={query.error} onRetry={() => query.refetch()} retrying={query.isFetching} />
          )}
        </div>
      </>
    );
  }

  const role = me.data.workspace?.role;
  return (
    <>
      <title>{`${query.data.client.name} · AI CRM`}</title>
      {back}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <ClientInfo client={query.data.client} currentUserId={me.data.user.id} canDelete={role ? can(role, "clients:delete") : false} />
        <Timeline clientId={id} currentUserId={me.data.user.id} />
      </div>
    </>
  );
}

function ClientInfo({ client, currentUserId, canDelete }: { client: Client; currentUserId: string; canDelete: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { byId: members } = useMembers();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const remove = useMutation({
    mutationFn: () => api(`/clients/${client.id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: queryKeys.client(client.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.clientsAll });
      router.replace("/clients");
    },
  });

  const owner = client.ownerId ? members.get(client.ownerId) : undefined;
  const deleteError = remove.error
    ? isApiError(remove.error, 409)
      ? "This client has invoices, so it can't be deleted. Mark it inactive instead."
      : remove.error.message
    : null;

  return (
    <section aria-labelledby="client-name" className="glass rounded-2xl p-5 sm:p-6 lg:sticky lg:top-24">
      <div className="flex items-start gap-4">
        <Avatar name={client.name} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 id="client-name" className="text-xl font-bold tracking-tight [overflow-wrap:anywhere] text-fg">
            {client.name}
          </h1>
          {client.company && <p className="mt-0.5 text-sm [overflow-wrap:anywhere] text-muted">{client.company}</p>}
          <div className="mt-2">
            <StatusBadge status={client.status} />
          </div>
        </div>
      </div>

      <div className="mt-5 flex gap-2">
        <Button variant="secondary" size="sm" onClick={() => setEditing(true)} className="flex-1">
          <Pencil className="size-4" aria-hidden="true" />
          Edit
        </Button>
        {canDelete && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDeleting(true)}
            className="hover:bg-danger-soft hover:text-danger-text"
            aria-label={`Delete ${client.name}`}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline lg:hidden xl:inline">Delete</span>
          </Button>
        )}
      </div>

      <dl className="mt-6 space-y-4 border-t border-border pt-5 text-sm">
        <InfoRow icon={Mail} label="Email">
          {client.email ? (
            <a href={`mailto:${client.email}`} className="font-medium [overflow-wrap:anywhere] text-primary-text underline-offset-4 hover:underline">
              {client.email}
            </a>
          ) : (
            <span className="text-subtle">Not added</span>
          )}
        </InfoRow>
        <InfoRow icon={Phone} label="Phone">
          {client.phone ? (
            <a href={`tel:${client.phone.replace(/\s/g, "")}`} className="font-medium text-primary-text underline-offset-4 hover:underline">
              {client.phone}
            </a>
          ) : (
            <span className="text-subtle">Not added</span>
          )}
        </InfoRow>
        <InfoRow icon={UserRound} label="Owner">
          <span className="font-medium text-fg">
            {client.ownerId ? (owner ? `${owner.name}${owner.userId === currentUserId ? " (you)" : ""}` : "…") : "Unassigned"}
          </span>
        </InfoRow>
      </dl>

      {client.notes && (
        <div className="mt-5 border-t border-border pt-5">
          <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">Notes</h2>
          <p className="mt-1.5 text-sm whitespace-pre-wrap [overflow-wrap:anywhere] text-fg">{client.notes}</p>
        </div>
      )}
      <p className="mt-5 text-xs text-muted">Added {formatDate(client.createdAt)}</p>

      <Dialog open={editing} onClose={() => setEditing(false)} title="Edit client">
        <ClientForm client={client} currentUserId={currentUserId} onCancel={() => setEditing(false)} onDone={() => setEditing(false)} />
      </Dialog>

      <Dialog
        open={deleting}
        onClose={() => {
          setDeleting(false);
          remove.reset();
        }}
        title={`Delete ${client.name}?`}
        description="This removes the client, their history timeline and their deals. It can't be undone."
      >
        <div className="space-y-4">
          {deleteError && <Alert>{deleteError}</Alert>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setDeleting(false)} disabled={remove.isPending}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => remove.mutate()} loading={remove.isPending}>
              <Trash2 className="size-4" aria-hidden="true" />
              Delete client
            </Button>
          </div>
        </div>
      </Dialog>
    </section>
  );
}

function InfoRow({ icon: Icon, label, children }: { icon: typeof Mail; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden="true" />
      <div className="min-w-0">
        <dt className="text-xs text-muted">{label}</dt>
        <dd className="mt-0.5">{children}</dd>
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]" aria-busy="true">
      <LoadingLabel>Loading client</LoadingLabel>
      <div className="glass space-y-4 rounded-2xl p-6">
        <div className="flex items-center gap-4">
          <Skeleton className="size-14 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="glass h-[60dvh] rounded-2xl p-5">
        <Skeleton className="h-5 w-24" />
      </div>
    </div>
  );
}
