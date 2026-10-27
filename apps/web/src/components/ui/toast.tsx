"use client";

import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import { useEffect, useEffectEvent } from "react";
import { cn } from "@/lib/cn";

export interface ToastMessage {
  /** Changes for every new message so the timer restarts even when the text repeats. */
  id: number;
  tone: "danger" | "success";
  text: string;
}

/**
 * One transient message at the bottom of the screen. It never takes focus; the live region
 * announces it. Auto-dismisses after 5s, or with the close button.
 */
export function Toast({ toast, onDismiss }: { toast: ToastMessage | null; onDismiss: () => void }) {
  const dismiss = useEffectEvent(onDismiss);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(dismiss, 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const Icon = toast?.tone === "success" ? CheckCircle2 : AlertTriangle;
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      {toast && (
        <div
          key={toast.id}
          role={toast.tone === "danger" ? "alert" : "status"}
          className="glass-strong pointer-events-auto flex w-full max-w-md animate-[toast-in_180ms_ease-out] items-start gap-3 rounded-2xl py-2 pr-2 pl-4 text-sm"
        >
          <Icon className={cn("mt-2.5 size-4.5 shrink-0", toast.tone === "success" ? "text-success-text" : "text-danger-text")} aria-hidden="true" />
          <p className="flex-1 py-2 text-fg">{toast.text}</p>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="flex size-10 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-primary-soft hover:text-fg"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
