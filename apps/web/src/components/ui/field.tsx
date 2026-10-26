import { useId } from "react";
import { cn } from "@/lib/cn";

export const controlClass =
  "block w-full rounded-xl border border-border bg-glass-strong px-3.5 text-base text-fg placeholder:text-subtle shadow-xs transition-[border-color,box-shadow] duration-150 hover:border-border-strong focus:border-primary focus:ring-4 focus:ring-primary-soft focus:outline-none aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger-soft disabled:opacity-60 sm:text-sm";

interface ControlProps {
  id: string;
  "aria-invalid": boolean | undefined;
  "aria-describedby": string | undefined;
  required: boolean | undefined;
}

interface FieldProps {
  label: string;
  error?: string[] | undefined;
  hint?: string;
  required?: boolean;
  className?: string;
  /** Receives the id and aria wiring for the control, so label and messages are always connected. */
  children: (props: ControlProps) => React.ReactNode;
}

export function Field({ label, error, hint, required, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error?.length ? `${id}-error` : undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-fg">
        {label}
        {required && (
          <span className="ml-0.5 text-danger-text" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children({
        id,
        "aria-invalid": errorId ? true : undefined,
        "aria-describedby": [hintId, errorId].filter(Boolean).join(" ") || undefined,
        required,
      })}
      {hint && !errorId && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {errorId && (
        <p id={errorId} className="text-xs font-medium text-danger-text">
          {error![0]}
        </p>
      )}
    </div>
  );
}

export function Input({ className, ...rest }: React.ComponentProps<"input">) {
  return <input className={cn(controlClass, "h-11", className)} {...rest} />;
}

export function Textarea({ className, ...rest }: React.ComponentProps<"textarea">) {
  return <textarea className={cn(controlClass, "min-h-24 resize-y py-2.5", className)} {...rest} />;
}

export function Select({ className, ...rest }: React.ComponentProps<"select">) {
  return <select className={cn(controlClass, "h-11 pr-9", className)} {...rest} />;
}
