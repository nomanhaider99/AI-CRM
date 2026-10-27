"use client";

import type { Announcements, CollisionDetection, DragEndEvent, DragOverEvent, DragStartEvent, UniqueIdentifier } from "@dnd-kit/core";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  getFirstCollision,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { IconButton } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format";
import type { Columns } from "@/lib/pipeline";
import { columnId, findStage, locate, moveInColumns, stageIdOf, toColumns, totalsByCurrency } from "@/lib/pipeline";
import type { Deal, Stage } from "@/lib/types";
import type { CardInfo } from "./deal-card";
import { DealCardView, SortableDealCard } from "./deal-card";

interface BoardProps {
  stages: Stage[];
  deals: Deal[];
  /** Cards to show; the rest stay in the columns (for positions) but are hidden by the filters. */
  isVisible: (deal: Deal) => boolean;
  cardInfo: (deal: Deal) => CardInfo;
  onOpen: (deal: Deal) => void;
  onAdd: (stageId: string) => void;
  /** Persists a move; resolves once the cache shows it, so the board can drop its drag state. */
  onMove: (dealId: string, stageId: string, index: number) => Promise<void>;
}

/** Stage dot color: green for won, red for lost, blue for open stages. Text carries the meaning. */
const stageTone = (name: string) => {
  const n = name.toLowerCase();
  return n === "won" ? "bg-success-text" : n === "lost" ? "bg-danger-text" : "bg-primary";
};

export function Board({ stages, deals, isVisible, cardInfo, onOpen, onAdd, onMove }: BoardProps) {
  const dndId = useId();
  const base = useMemo(() => toColumns(stages, deals), [stages, deals]);
  const byId = useMemo(() => new Map(deals.map((d) => [d.id, d])), [deals]);
  const stageName = useMemo(() => new Map(stages.map((s) => [s.id, s.name])), [stages]);

  // While dragging, the board renders this working copy; the cache changes only on drop.
  const [draft, setDraft] = useState<Columns | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const columns = draft ?? base;
  const lastOverId = useRef<UniqueIdentifier | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Press and hold to drag on touch screens, so a swipe still scrolls the board.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Pointer inside a column: snap to the nearest card in it, or the column itself when it is empty.
  const collisionDetection: CollisionDetection = (args) => {
    const hits = pointerWithin(args);
    let overId = getFirstCollision(hits.length > 0 ? hits : rectIntersection(args), "id");
    if (overId != null) {
      const stageId = stageIdOf(String(overId));
      const ids = stageId ? columns[stageId] : undefined;
      if (ids && ids.length > 0) {
        const cards = args.droppableContainers.filter((c) => ids.includes(String(c.id)));
        overId = closestCenter({ ...args, droppableContainers: cards })[0]?.id ?? overId;
      }
      lastOverId.current = overId;
      return [{ id: overId }];
    }
    return lastOverId.current != null ? [{ id: lastOverId.current }] : [];
  };

  const titleOf = (id: UniqueIdentifier) => byId.get(String(id))?.title ?? "Deal";
  const stageOfTarget = (id: UniqueIdentifier) => {
    const stageId = stageIdOf(String(id)) ?? findStage(columns, String(id));
    return stageId ? stageName.get(stageId) : undefined;
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${titleOf(active.id)}.`,
    onDragOver: ({ active, over }) => (over ? `${titleOf(active.id)} is over ${stageOfTarget(over.id) ?? "a column"}.` : `${titleOf(active.id)} is not over a column.`),
    onDragEnd: ({ active, over }) => (over ? `${titleOf(active.id)} dropped in ${stageOfTarget(over.id) ?? "a column"}.` : `${titleOf(active.id)} was not moved.`),
    onDragCancel: ({ active }) => `Moving ${titleOf(active.id)} was cancelled.`,
  };

  function handleDragStart({ active }: DragStartEvent) {
    setActiveId(String(active.id));
    setDraft(base);
  }

  // Crossing into another column moves the card there right away, so the column opens a gap for it.
  function handleDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    const dealId = String(active.id);
    const overId = String(over.id);
    setDraft((prev) => {
      if (!prev) return prev;
      const from = findStage(prev, dealId);
      const to = stageIdOf(overId) ?? findStage(prev, overId);
      if (!from || !to || from === to) return prev;
      if (stageIdOf(overId)) return moveInColumns(prev, dealId, to, prev[to]!.length);
      const translated = active.rect.current.translated;
      const below = translated !== null && translated.top > over.rect.top + over.rect.height / 2;
      return moveInColumns(prev, dealId, to, prev[to]!.indexOf(overId) + (below ? 1 : 0));
    });
  }

  async function handleDragEnd({ active, over }: DragEndEvent) {
    const dealId = String(active.id);
    setActiveId(null);
    lastOverId.current = null;
    if (!over || !draft) return setDraft(null);

    // Reordering within the column the card is now in.
    let final = draft;
    const stageId = findStage(draft, dealId);
    const overId = String(over.id);
    if (stageId && !stageIdOf(overId) && findStage(draft, overId) === stageId) {
      final = moveInColumns(draft, dealId, stageId, draft[stageId]!.indexOf(overId));
    }
    const target = locate(final, dealId);
    setDraft(final);
    try {
      if (target) await onMove(dealId, target.stageId, target.index);
    } finally {
      setDraft(null);
    }
  }

  function handleDragCancel() {
    setActiveId(null);
    setDraft(null);
    lastOverId.current = null;
  }

  const active = activeId ? byId.get(activeId) : undefined;
  const activeStage = activeId ? findStage(columns, activeId) : undefined;

  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: "To move a deal, press Space on its grip. Use the arrow keys to move it, Space again to drop it, or Escape to cancel.",
        },
      }}
    >
      <div className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-6 sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:snap-none">
        {stages.map((stage) => {
          const all = (columns[stage.id] ?? []).flatMap((id) => byId.get(id) ?? []);
          const shown = all.filter((d) => d.id === activeId || isVisible(d));
          return (
            <Column key={stage.id} stage={stage} deals={shown} hiddenCount={all.length - shown.length} highlighted={activeStage === stage.id} onAdd={onAdd}>
              {shown.map((d) => (
                <SortableDealCard key={d.id} deal={d} onOpen={onOpen} {...cardInfo(d)} />
              ))}
            </Column>
          );
        })}
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
        {active ? <DealCardView deal={active} overlay {...cardInfo(active)} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

interface ColumnProps {
  stage: Stage;
  deals: Deal[];
  hiddenCount: number;
  highlighted: boolean;
  onAdd: (stageId: string) => void;
  children: React.ReactNode;
}

function Column({ stage, deals, hiddenCount, highlighted, onAdd, children }: ColumnProps) {
  const { setNodeRef } = useDroppable({ id: columnId(stage.id) });
  const headingId = useId();
  const totals = totalsByCurrency(deals);

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "glass flex w-[min(20rem,calc(100vw-3rem))] shrink-0 snap-start flex-col rounded-2xl transition-[box-shadow] duration-150 sm:w-72",
        highlighted && "ring-2 ring-primary/40",
      )}
    >
      <header className="flex items-start gap-2 px-3.5 pt-3 pb-2">
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="flex items-center gap-2 text-sm font-semibold text-fg">
            <span className={cn("size-2 shrink-0 rounded-full", stageTone(stage.name))} aria-hidden="true" />
            <span className="truncate">{stage.name}</span>
            <span className="rounded-full bg-neutral-soft px-2 py-0.5 text-xs font-semibold text-neutral-text tabular-nums">
              {deals.length}
              <span className="sr-only"> deals</span>
            </span>
          </h2>
          <p className="mt-0.5 truncate text-xs text-muted tabular-nums">
            {totals.length === 0 ? "No value yet" : totals.map((t) => formatMoney(t.total, t.currency)).join(" · ")}
          </p>
        </div>
        <IconButton label={`Add deal to ${stage.name}`} onClick={() => onAdd(stage.id)} className="-mt-1.5 -mr-1.5">
          <Plus className="size-4.5" aria-hidden="true" />
        </IconButton>
      </header>
      <SortableContext id={columnId(stage.id)} items={deals.map((d) => d.id)} strategy={verticalListSortingStrategy}>
        <ul ref={setNodeRef} aria-label={`${stage.name} deals`} className="flex min-h-28 flex-1 flex-col gap-2 px-2 pb-2">
          {children}
          {deals.length === 0 && (
            <li
              className={cn(
                "flex flex-1 items-center justify-center rounded-xl border border-dashed px-3 py-6 text-center text-xs text-subtle transition-colors duration-150",
                highlighted ? "border-primary/50 bg-primary-soft text-primary-text" : "border-border",
              )}
            >
              {hiddenCount > 0 ? `${hiddenCount} hidden by filters` : "Drop a deal here"}
            </li>
          )}
        </ul>
      </SortableContext>
    </section>
  );
}
