import type { ClientStatus, Role } from "@crm/shared";
import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";

type Tone = "primary" | "success" | "warning" | "neutral" | "accent" | "danger";

const tones: Record<Tone, string> = {
  primary: "bg-primary-soft text-primary-text",
  success: "bg-success-soft text-success-text",
  warning: "bg-warning-soft text-warning-text",
  neutral: "bg-neutral-soft text-neutral-text",
  accent: "bg-accent-soft text-accent-text",
  danger: "bg-danger-soft text-danger-text",
};

export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap", tones[tone], className)}>
      {children}
    </span>
  );
}

const statusTone: Record<ClientStatus, Tone> = { lead: "primary", active: "success", inactive: "neutral" };
export const STATUS_LABELS: Record<ClientStatus, string> = { lead: "Lead", active: "Active", inactive: "Inactive" };

// The dot is decorative; the label carries the meaning, so status is never color-only.
export function StatusBadge({ status }: { status: ClientStatus }) {
  return (
    <Badge tone={statusTone[status]}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {STATUS_LABELS[status]}
    </Badge>
  );
}

export const ROLE_LABELS: Record<Role, string> = { admin: "Admin", pm: "Project manager", seller: "Seller" };

export function RoleBadge({ role }: { role: Role }) {
  return <Badge tone={role === "admin" ? "accent" : role === "pm" ? "primary" : "neutral"}>{ROLE_LABELS[role]}</Badge>;
}

// A stable hue per name, so the same person always gets the same avatar color.
const avatarTones = ["bg-primary-soft text-primary-text", "bg-accent-soft text-accent-text", "bg-success-soft text-success-text", "bg-warning-soft text-warning-text"];

export function Avatar({ name, size = "md", className }: { name: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const hash = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        size === "sm" && "size-8 text-xs",
        size === "md" && "size-10 text-sm",
        size === "lg" && "size-14 text-lg",
        avatarTones[hash % avatarTones.length],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
