"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Building2, GripVertical, Lock } from "lucide-react";
import { Avatar } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format";
import type { Deal } from "@/lib/types";

export interface CardInfo {
  /** Owner's name, "Unassigned", or undefined while members load. */
  ownerLabel: string | undefined;
  /** Why the current user cannot move or edit this deal; undefined when they can. */
  lockReason: string | undefined;
}

interface DealCardProps extends CardInfo {
  deal: Deal;
  onOpen: (deal: Deal) => void;
}

/**
 * A draggable card. Mouse and touch drag the whole card (after a small move or a short press, so
 * taps and scrolling still work); keyboard users pick it up from the grip button with Space.
 */
export function SortableDealCard({ deal, onOpen, ownerLabel, lockReason }: DealCardProps) {
  const locked = lockReason !== undefined;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: deal.id,
    // Locked cards still take part in sorting so others can be dropped around them.
    disabled: { draggable: locked, droppable: false },
  });
  // Pointer listeners go on the card, the keyboard one on the grip (Space/Enter on the title opens it).
  const entries = Object.entries(listeners ?? {});
  const pointerListeners = Object.fromEntries(entries.filter(([name]) => name !== "onKeyDown"));
  const keyListeners = Object.fromEntries(entries.filter(([name]) => name === "onKeyDown"));

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("touch-manipulation", isDragging && "opacity-40")}
      {...(locked ? {} : pointerListeners)}
    >
      <DealCardView
        deal={deal}
        ownerLabel={ownerLabel}
        lockReason={lockReason}
        onOpen={() => onOpen(deal)}
        handle={
          !locked && (
            <button
              ref={setActivatorNodeRef}
              type="button"
              {...attributes}
              {...keyListeners}
              aria-label={`Move ${deal.title}`}
              className="relative z-10 -my-1 -mr-1.5 flex h-10 w-8 shrink-0 cursor-grab items-center justify-center rounded-lg text-subtle transition-colors duration-150 hover:bg-primary-soft hover:text-fg active:cursor-grabbing"
            >
              <GripVertical className="size-4.5" aria-hidden="true" />
            </button>
          )
        }
      />
    </li>
  );
}

interface DealCardViewProps extends CardInfo {
  deal: Deal;
  onOpen?: () => void;
  handle?: React.ReactNode;
  /** Rendered in the drag overlay: lifted look, no interactive parts. */
  overlay?: boolean;
}

export function DealCardView({ deal, ownerLabel, lockReason, onOpen, handle, overlay = false }: DealCardViewProps) {
  const locked = lockReason !== undefined;
  return (
    <article
      className={cn(
        "relative rounded-xl border p-3 transition-[border-color,box-shadow,background-color] duration-150",
        locked ? "border-dashed border-border bg-glass-strong/50" : "cursor-grab border-border bg-glass-strong shadow-xs hover:border-border-strong hover:shadow-sm",
        overlay && "rotate-[1.5deg] cursor-grabbing border-primary/40 shadow-float ring-2 ring-primary/30",
      )}
    >
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 text-sm leading-snug font-semibold text-fg">
          {onOpen ? (
            // The stretched ::after makes the whole card open the drawer; the grip sits above it.
            <button
              type="button"
              onClick={onOpen}
              className="text-left break-words after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-ring"
            >
              {deal.title}
            </button>
          ) : (
            <span className="break-words">{deal.title}</span>
          )}
        </h3>
        {handle}
        {locked && (
          <span title={lockReason} className="relative z-10 -mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-neutral-soft text-neutral-text">
            <Lock className="size-3.5" aria-hidden="true" />
            <span className="sr-only">Locked. {lockReason}</span>
          </span>
        )}
      </div>
      <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
        <Building2 className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{deal.clientName}</span>
      </p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-fg tabular-nums">{formatMoney(deal.value, deal.currency)}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
          {deal.ownerId && ownerLabel ? (
            <>
              <Avatar name={ownerLabel} size="sm" className="size-6 text-[10px]" />
              <span className="truncate">{ownerLabel}</span>
            </>
          ) : (
            <span className="truncate italic">{ownerLabel ?? "…"}</span>
          )}
        </span>
      </div>
    </article>
  );
}
