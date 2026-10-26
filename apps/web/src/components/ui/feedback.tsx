import { AlertTriangle, RotateCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-neutral-soft", className)} aria-hidden="true" />;
}

/** Screen-reader announcement for a loading region, paired with skeletons. */
export const LoadingLabel = ({ children }: { children: string }) => (
  <span role="status" className="sr-only">
    {children}
  </span>
);

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, children, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-14 text-center", className)}>
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary-soft text-primary-text">
        <Icon className="size-7" aria-hidden="true" />
      </div>
      <h2 className="text-base font-semibold text-fg">{title}</h2>
      {children && <p className="mt-1 max-w-sm text-sm text-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

interface ErrorStateProps {
  title?: string;
  error: unknown;
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}

export function ErrorState({ title = "Couldn't load this", error, onRetry, retrying, className }: ErrorStateProps) {
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return (
    <div role="alert" className={cn("flex flex-col items-center px-6 py-14 text-center", className)}>
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-danger-soft text-danger-text">
        <AlertTriangle className="size-7" aria-hidden="true" />
      </div>
      <h2 className="text-base font-semibold text-fg">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-muted">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-primary-text hover:bg-primary-soft disabled:opacity-50"
        >
          <RotateCw className={cn("size-4", retrying && "animate-spin")} aria-hidden="true" />
          Try again
        </button>
      )}
    </div>
  );
}

/** Inline form-level message (server errors that are not tied to one field). */
export function Alert({ children, tone = "danger" }: { children: React.ReactNode; tone?: "danger" | "success" }) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-xl px-3.5 py-3 text-sm",
        tone === "danger" ? "bg-danger-soft text-danger-text" : "bg-success-soft text-success-text",
      )}
    >
      {tone === "danger" && <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
      <span>{children}</span>
    </div>
  );
}
