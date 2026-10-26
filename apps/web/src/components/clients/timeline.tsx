"use client";

import type { ClientEventType } from "@crm/shared";
import { CLIENT_EVENT_TYPES, createClientEventSchema } from "@crm/shared";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BadgeDollarSign, ChevronDown, FileText, History, MessageSquare, Phone, SendHorizontal, StickyNote } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState, ErrorState, LoadingLabel, Skeleton, Spinner } from "@/components/ui/feedback";
import { Field, Input, Textarea } from "@/components/ui/field";
import type { FieldErrors } from "@/lib/api";
import { api, isApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { dayKey, dayLabel, formatAmount, formatTime } from "@/lib/format";
import { queryKeys, useMembers } from "@/lib/queries";
import type { ClientEvent, Page } from "@/lib/types";
import { validate } from "@/lib/validation";

const PAGE_SIZE = 20;

const TYPES: Record<ClientEventType, { label: string; icon: LucideIcon; chip: string; placeholder: string }> = {
  note: { label: "Note", icon: StickyNote, chip: "bg-warning-soft text-warning-text", placeholder: "Write a note…" },
  call: { label: "Call", icon: Phone, chip: "bg-success-soft text-success-text", placeholder: "What was the call about?" },
  message: { label: "Message", icon: MessageSquare, chip: "bg-primary-soft text-primary-text", placeholder: "Summarize the message…" },
  sale: { label: "Sale", icon: BadgeDollarSign, chip: "bg-accent-soft text-accent-text", placeholder: "What was sold? e.g. 3 logo designs" },
  invoice: { label: "Invoice", icon: FileText, chip: "bg-neutral-soft text-neutral-text", placeholder: "Invoice summary…" },
};
const HAS_AMOUNT: ClientEventType[] = ["sale", "invoice"];

/**
 * Client history as a chat: oldest at the top, newest at the bottom next to the composer.
 * The API pages newest first, so older pages are prepended with "Load earlier".
 */
export function Timeline({ clientId, currentUserId }: { clientId: string; currentUserId: string }) {
  const { byId: members } = useMembers();
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const heightBeforeLoad = useRef<number | null>(null);

  const query = useInfiniteQuery({
    queryKey: queryKeys.events(clientId),
    queryFn: ({ pageParam, signal }) =>
      api<{ events: ClientEvent[] } & Page>(`/clients/${clientId}/events`, { query: { limit: PAGE_SIZE, offset: pageParam }, signal }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.offset + last.events.length < last.total ? last.offset + last.limit : undefined),
  });

  const events = (query.data?.pages.flatMap((p) => p.events) ?? []).toReversed();
  const total = query.data?.pages[0]?.total ?? 0;

  // Land on the newest entry; when older entries are prepended, keep the reader where they were.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || events.length === 0) return;
    if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
      stickToBottom.current = false;
    } else if (heightBeforeLoad.current !== null) {
      el.scrollTop += el.scrollHeight - heightBeforeLoad.current;
      heightBeforeLoad.current = null;
    }
  }, [events.length]);

  const loadEarlier = () => {
    heightBeforeLoad.current = listRef.current?.scrollHeight ?? null;
    void query.fetchNextPage();
  };

  return (
    <section aria-labelledby="history-heading" className="glass flex h-[75dvh] min-h-[28rem] flex-col overflow-hidden rounded-2xl lg:h-[calc(100dvh-9rem)]">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
        <h2 id="history-heading" className="flex items-center gap-2 font-semibold text-fg">
          <History className="size-5 text-muted" aria-hidden="true" />
          History
        </h2>
        {total > 0 && (
          <span className="text-sm text-muted tabular-nums">
            {total} {total === 1 ? "entry" : "entries"}
          </span>
        )}
      </header>

      <div ref={listRef} className="flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-5" aria-busy={query.isFetching}>
        {query.isPending ? (
          <TimelineSkeleton />
        ) : query.isError ? (
          <ErrorState title="Couldn't load the history" error={query.error} onRetry={() => query.refetch()} retrying={query.isFetching} />
        ) : events.length === 0 ? (
          <EmptyState icon={History} title="No history yet" className="h-full justify-center">
            Log a call, note, message or sale below. New sellers will read this timeline to get up to speed.
          </EmptyState>
        ) : (
          <>
            {query.hasNextPage && (
              <div className="mb-4 flex justify-center">
                <Button variant="secondary" size="sm" onClick={loadEarlier} loading={query.isFetchingNextPage}>
                  Load earlier
                </Button>
              </div>
            )}
            <ol className="space-y-3" aria-label="Client history, oldest first">
              {events.map((event, i) => {
                const newDay = i === 0 || dayKey(events[i - 1]!.createdAt) !== dayKey(event.createdAt);
                return (
                  <Fragment key={event.id}>
                    {newDay && (
                      <li aria-hidden="true" className="flex items-center gap-3 py-2">
                        <span className="h-px flex-1 bg-border" />
                        <span className="text-xs font-semibold text-muted">{dayLabel(event.createdAt)}</span>
                        <span className="h-px flex-1 bg-border" />
                      </li>
                    )}
                    <Bubble
                      event={event}
                      mine={event.createdBy === currentUserId}
                      author={event.createdBy ? (members.get(event.createdBy)?.name ?? "Former member") : "Unknown"}
                    />
                  </Fragment>
                );
              })}
            </ol>
          </>
        )}
      </div>

      <Composer
        clientId={clientId}
        onPosted={() => {
          stickToBottom.current = true;
        }}
      />
    </section>
  );
}

function Bubble({ event, mine, author }: { event: ClientEvent; mine: boolean; author: string }) {
  const t = TYPES[event.type];
  const Icon = t.icon;
  return (
    <li className={cn("flex items-end gap-2", mine && "flex-row-reverse")}>
      {!mine && <Avatar name={author} size="sm" className="mb-5 hidden sm:inline-flex" />}
      <div className={cn("flex max-w-[88%] flex-col sm:max-w-[75%]", mine ? "items-end" : "items-start")}>
        <article
          className={cn(
            "rounded-2xl border px-4 py-3 shadow-xs",
            mine ? "rounded-br-md border-bubble-mine-border bg-bubble-mine" : "rounded-bl-md border-border bg-bubble",
          )}
        >
          <span className={cn("mb-1.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold", t.chip)}>
            <Icon className="size-3.5" aria-hidden="true" />
            {t.label}
          </span>
          <h3 className="font-semibold [overflow-wrap:anywhere] text-fg">{event.title}</h3>
          {event.body && <p className="mt-1 text-sm whitespace-pre-wrap [overflow-wrap:anywhere] text-fg/90">{event.body}</p>}
          {event.amount !== null && (
            <p className="mt-2 text-sm">
              <span className="text-muted">Amount </span>
              <span className="font-semibold text-fg tabular-nums">{formatAmount(event.amount)}</span>
            </p>
          )}
        </article>
        <p className="mt-1 px-1 text-xs text-muted">
          {mine ? "You" : author} · <time dateTime={event.createdAt}>{formatTime(event.createdAt)}</time>
        </p>
      </div>
    </li>
  );
}

function Composer({ clientId, onPosted }: { clientId: string; onPosted: () => void }) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<ClientEventType>("note");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [amount, setAmount] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const titleRef = useRef<HTMLInputElement>(null);
  const withAmount = HAS_AMOUNT.includes(type);

  const post = useMutation({
    mutationFn: (input: unknown) => api(`/clients/${clientId}/events`, { method: "POST", body: input }),
    onSuccess: async () => {
      setTitle("");
      setBody("");
      setAmount("");
      setShowDetails(false);
      onPosted();
      await queryClient.invalidateQueries({ queryKey: queryKeys.events(clientId) });
      titleRef.current?.focus();
    },
    onError: (err) => {
      if (isApiError(err)) setErrors(err.fieldErrors);
    },
  });

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (post.isPending) return;
    const parsedAmount = withAmount && amount.trim() !== "" ? Number(amount.replace(/,/g, "")) : undefined;
    const result = validate(createClientEventSchema, {
      type,
      title,
      body: body.trim() === "" ? undefined : body,
      amount: parsedAmount,
    });
    setErrors(result.errors ?? {});
    if (result.errors) {
      if (result.errors.title) titleRef.current?.focus();
      return;
    }
    post.mutate(result.data);
  }

  const serverError = post.error && Object.keys(errors).length === 0 ? post.error.message : null;

  return (
    <form onSubmit={submit} noValidate className="space-y-3 border-t border-border bg-glass-strong/60 px-3 py-3 sm:px-5" aria-label="Add to history">
      {serverError && <Alert>{serverError}</Alert>}
      <div role="radiogroup" aria-label="Entry type" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5">
        {CLIENT_EVENT_TYPES.map((value) => {
          const t = TYPES[value];
          const Icon = t.icon;
          const selected = type === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setType(value)}
              className={cn(
                "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors duration-150",
                selected ? cn(t.chip, "ring-1 ring-current") : "text-muted hover:bg-primary-soft hover:text-fg",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="flex items-start gap-2">
        <div className="flex-1">
          <label htmlFor="event-title" className="sr-only">
            {TYPES[type].label} summary
          </label>
          <Input
            ref={titleRef}
            id="event-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={TYPES[type].placeholder}
            autoComplete="off"
            maxLength={200}
            aria-invalid={errors.title ? true : undefined}
            aria-describedby={errors.title ? "event-title-error" : undefined}
          />
          {errors.title && (
            <p id="event-title-error" className="mt-1.5 text-xs font-medium text-danger-text">
              {errors.title[0]}
            </p>
          )}
        </div>
        <Button type="submit" disabled={post.isPending} className="w-11 px-0 sm:w-auto sm:px-4.5" aria-label="Add to history">
          {post.isPending ? <Spinner className="size-4.5" /> : <SendHorizontal className="size-4.5" aria-hidden="true" />}
          <span className="hidden sm:inline">Add</span>
        </Button>
      </div>

      {(showDetails || withAmount) && (
        <div className={cn("grid gap-3", withAmount && "sm:grid-cols-[1fr_10rem]")}>
          {showDetails && (
            <Field label="Details" error={errors.body}>
              {(p) => (
                <Textarea
                  {...p}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={3}
                  placeholder="Optional. Ctrl+Enter to add."
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit();
                  }}
                />
              )}
            </Field>
          )}
          {withAmount && (
            <Field label="Amount" error={errors.amount} className={cn(!showDetails && "sm:col-start-2")}>
              {(p) => <Input {...p} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="150.00" className="tabular-nums" />}
            </Field>
          )}
        </div>
      )}

      {!showDetails && (
        <button
          type="button"
          onClick={() => setShowDetails(true)}
          className="inline-flex h-8 items-center gap-1 rounded-lg px-1.5 text-sm font-medium text-muted hover:text-fg"
        >
          <ChevronDown className="size-4" aria-hidden="true" />
          Add details
        </button>
      )}
    </form>
  );
}

function TimelineSkeleton() {
  return (
    <div className="space-y-4">
      <LoadingLabel>Loading history</LoadingLabel>
      {[false, true, false].map((mine, i) => (
        <div key={i} className={cn("flex", mine && "justify-end")}>
          <Skeleton className={cn("h-20 rounded-2xl", i === 1 ? "w-1/2" : "w-2/3")} />
        </div>
      ))}
    </div>
  );
}
