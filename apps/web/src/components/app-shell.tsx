"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, KanbanSquare, LogOut, Menu, Plus, Settings, Users, UsersRound, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { Avatar, RoleBadge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/button";
import { ErrorState, LoadingLabel, Skeleton } from "@/components/ui/feedback";
import { Select } from "@/components/ui/field";
import { api, isApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useMe } from "@/lib/queries";
import type { Me } from "@/lib/types";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Not built yet: shown so the product shape is clear, but not a link. */
  soon?: boolean;
}

const NAV: NavItem[] = [
  { label: "Clients", href: "/clients", icon: Users },
  { label: "Pipeline", href: "/pipeline", icon: KanbanSquare },
  { label: "Invoices", href: "/invoices", icon: FileText },
  { label: "Members", href: "/members", icon: UsersRound, soon: true },
  { label: "Settings", href: "/settings", icon: Settings, soon: true },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  // The Kanban board uses the full width; other pages keep a readable measure.
  const wide = pathname === "/pipeline";
  const [drawerOpen, setDrawerOpen] = useState(false);
  const needsWorkspace = me.data && !me.data.workspace;

  useEffect(() => {
    if (needsWorkspace) router.replace("/onboarding");
  }, [needsWorkspace, router]);

  if (me.isError && !isApiError(me.error, 401)) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-4">
        <div className="glass w-full max-w-md rounded-3xl">
          <ErrorState title="Couldn't load your workspace" error={me.error} onRetry={() => me.refetch()} retrying={me.isFetching} />
        </div>
      </main>
    );
  }
  // Pending, redirecting to login (401) or to onboarding: keep the frame steady with skeletons.
  if (!me.data || needsWorkspace) return <ShellSkeleton />;

  return (
    <div className="min-h-dvh lg:pl-72 print:pl-0">
      <a
        href="#main"
        className="sr-only z-50 rounded-xl bg-primary px-4 py-2 font-semibold text-on-primary focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 p-3 lg:block print:hidden">
        <Sidebar me={me.data} />
      </aside>

      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Sidebar me={me.data} onNavigate={() => setDrawerOpen(false)} showThemeToggle />
      </MobileDrawer>

      <header className="sticky top-0 z-20 px-3 pt-3 print:hidden">
        <div className="glass flex h-16 items-center gap-2 rounded-2xl px-2 sm:px-4">
          <IconButton label="Open navigation" onClick={() => setDrawerOpen(true)} className="lg:hidden" aria-expanded={drawerOpen}>
            <Menu className="size-5" aria-hidden="true" />
          </IconButton>
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className="truncate font-semibold text-fg">{me.data.workspace!.name}</span>
            <span className="hidden sm:inline-flex">
              <RoleBadge role={me.data.workspace!.role} />
            </span>
          </div>
          <ThemeToggle className="hidden sm:inline-flex" />
          <span className="hidden items-center gap-2.5 border-l border-border pl-3 md:flex">
            <Avatar name={me.data.user.name} size="sm" />
            <span className="max-w-40 truncate text-sm font-medium text-fg">{me.data.user.name}</span>
          </span>
        </div>
      </header>

      <main id="main" tabIndex={-1} className={cn("mx-auto w-full px-4 pt-6 pb-16 outline-none sm:px-6 print:p-0", wide ? "max-w-none" : "max-w-6xl")}>
        {children}
      </main>
    </div>
  );
}

function Sidebar({ me, onNavigate, showThemeToggle = false }: { me: Me; onNavigate?: () => void; showThemeToggle?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();

  const logout = useMutation({
    mutationFn: () => api("/auth/logout", { method: "POST" }),
    onSettled: () => {
      queryClient.clear();
      router.replace("/login");
    },
  });

  const switchWorkspace = useMutation({
    mutationFn: (id: string) => api(`/workspaces/${id}/switch`, { method: "POST" }),
    onSuccess: () => {
      // Different tenant: drop every cached row from the previous workspace.
      queryClient.clear();
      onNavigate?.();
      router.push("/clients");
    },
  });

  return (
    <nav aria-label="Main" className="glass flex h-full flex-col rounded-2xl p-3">
      <Link href="/clients" onClick={onNavigate} className="mb-4 flex h-12 items-center rounded-xl px-2">
        <Brand />
      </Link>

      <div className="mb-4 px-1">
        {me.workspaces.length > 1 ? (
          <>
            <label htmlFor="workspace-switch" className="mb-1.5 block text-xs font-semibold tracking-wide text-muted uppercase">
              Workspace
            </label>
            <Select
              id="workspace-switch"
              value={me.workspace?.id}
              disabled={switchWorkspace.isPending}
              onChange={(e) => switchWorkspace.mutate(e.target.value)}
            >
              {me.workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </>
        ) : null}
        <Link
          href="/onboarding"
          onClick={onNavigate}
          className="mt-2 inline-flex h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-muted hover:bg-primary-soft hover:text-fg"
        >
          <Plus className="size-4" aria-hidden="true" />
          New workspace
        </Link>
      </div>

      <ul className="flex-1 space-y-1">
        {NAV.map(({ label, href, icon: Icon, soon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          const content = (
            <>
              <Icon className="size-5 shrink-0" aria-hidden="true" />
              <span className="flex-1">{label}</span>
              {soon && <span className="rounded-full bg-neutral-soft px-2 py-0.5 text-[11px] font-semibold text-neutral-text">Soon</span>}
            </>
          );
          const cls = "flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors duration-150";
          return (
            <li key={href}>
              {soon ? (
                <span aria-disabled="true" title={`${label} is coming in a later step`} className={cn(cls, "cursor-not-allowed text-subtle")}>
                  {content}
                </span>
              ) : (
                <Link
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(cls, active ? "bg-primary text-on-primary shadow-sm shadow-primary/25" : "text-muted hover:bg-primary-soft hover:text-fg")}
                >
                  {content}
                </Link>
              )}
            </li>
          );
        })}
      </ul>

      {showThemeToggle && <ThemeToggle className="mb-3 self-start sm:hidden" />}

      <div className="mt-3 border-t border-border pt-3">
        <div className="flex items-center gap-3 px-2 py-1.5">
          <Avatar name={me.user.name} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-fg">{me.user.name}</p>
            <p className="truncate text-xs text-muted">{me.user.email}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          className="mt-1 flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium text-muted transition-colors duration-150 hover:bg-danger-soft hover:text-danger-text disabled:opacity-50"
        >
          <LogOut className="size-5" aria-hidden="true" />
          Sign out
        </button>
      </div>
    </nav>
  );
}

/** Off-canvas navigation below lg, on a native modal <dialog> (focus trap, Escape, inert page). */
function MobileDrawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      aria-label="Navigation"
      className="m-0 h-dvh max-h-dvh w-[min(20rem,calc(100%-3rem))] max-w-none bg-transparent p-3 open:animate-[drawer-in_200ms_ease-out] lg:hidden"
    >
      <div className="relative h-full">
        <IconButton label="Close navigation" onClick={onClose} className="absolute top-3 right-3 z-10">
          <X className="size-5" aria-hidden="true" />
        </IconButton>
        {children}
      </div>
    </dialog>
  );
}

function ShellSkeleton() {
  return (
    <div className="min-h-dvh lg:pl-72" aria-busy="true">
      <LoadingLabel>Loading your workspace</LoadingLabel>
      <div className="fixed inset-y-0 left-0 hidden w-72 p-3 lg:block">
        <div className="glass h-full space-y-3 rounded-2xl p-4">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="mt-6 h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      </div>
      <div className="px-3 pt-3">
        <div className="glass flex h-16 items-center gap-3 rounded-2xl px-4">
          <Skeleton className="h-5 w-40" />
        </div>
      </div>
      <div className="mx-auto max-w-6xl space-y-4 px-4 pt-6 sm:px-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    </div>
  );
}
