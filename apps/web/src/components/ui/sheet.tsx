"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { IconButton } from "./button";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Small line above the title, e.g. the record type. */
  eyebrow?: string;
  children: React.ReactNode;
}

/**
 * Detail panel that slides in from the right (full width on phones), on a native modal <dialog>
 * like Dialog: focus trap, Escape, inert page and focus return come from the browser.
 */
export function Sheet({ open, onClose, title, eyebrow, children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      aria-labelledby={titleId}
      className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-none bg-transparent p-0 text-fg open:animate-[sheet-in_220ms_ease-out] sm:w-[28rem] sm:p-3"
    >
      {open && (
        <div className="glass-strong flex h-full flex-col sm:rounded-2xl">
          <div className="flex items-start justify-between gap-3 border-b border-border px-5 pt-4 pb-3">
            <div className="min-w-0 pt-1.5">
              {eyebrow && <p className="text-xs font-semibold tracking-wide text-muted uppercase">{eyebrow}</p>}
              <h2 id={titleId} className="text-lg font-semibold break-words text-fg">
                {title}
              </h2>
            </div>
            <IconButton label="Close" onClick={onClose} className="-mr-2">
              <X className="size-5" aria-hidden="true" />
            </IconButton>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}
