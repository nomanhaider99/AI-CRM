"use client";

import { createWorkspaceSchema } from "@crm/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, LogOut } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import type { FieldErrors } from "@/lib/api";
import { api, isApiError } from "@/lib/api";
import { useMe } from "@/lib/queries";
import { validate } from "@/lib/validation";

export default function OnboardingPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useMe();
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  const create = useMutation({
    mutationFn: (body: unknown) => api("/workspaces", { method: "POST", body }),
    onSuccess: async () => {
      // A new workspace means a new tenant: nothing cached from another one may leak in.
      queryClient.clear();
      router.replace("/clients");
    },
    onError: (err) => {
      if (isApiError(err)) setErrors(err.fieldErrors);
    },
  });

  const logout = useMutation({
    mutationFn: () => api("/auth/logout", { method: "POST" }),
    onSettled: () => {
      queryClient.clear();
      router.replace("/login");
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const result = validate(createWorkspaceSchema, { name });
    setErrors(result.errors ?? {});
    if (result.data) create.mutate(result.data);
  }

  if (me.isPending) {
    return (
      <div className="glass w-full max-w-md space-y-4 rounded-3xl p-8" aria-busy="true">
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  }
  if (me.isError) {
    return (
      <div className="glass w-full max-w-md rounded-3xl">
        <ErrorState error={me.error} onRetry={() => me.refetch()} retrying={me.isFetching} />
      </div>
    );
  }

  const firstName = me.data.user.name.split(" ")[0];
  const hasWorkspace = me.data.workspaces.length > 0;
  const serverError = create.error && Object.keys(errors).length === 0 ? create.error.message : null;

  return (
    <div className="glass w-full max-w-md rounded-3xl p-6 sm:p-8">
      <title>Create workspace · AI CRM</title>
      {!hasWorkspace && <p className="text-xs font-semibold tracking-wide text-primary-text uppercase">Step 2 of 2</p>}
      <div className="mt-3 mb-1 flex size-12 items-center justify-center rounded-2xl bg-primary-soft text-primary-text">
        <Building2 className="size-6" aria-hidden="true" />
      </div>
      <h1 className="mt-4 text-2xl font-bold tracking-tight text-fg">
        {hasWorkspace ? "Create another workspace" : `Welcome, ${firstName}`}
      </h1>
      <p className="mt-1 text-sm text-muted">
        A workspace holds your team&apos;s clients, deals and invoices. You&apos;ll be its admin and can invite your team next.
      </p>

      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
        {serverError && <Alert>{serverError}</Alert>}
        <Field label="Workspace name" error={errors.name} hint="Usually your company or team name." required>
          {(p) => (
            <Input {...p} name="name" autoComplete="organization" placeholder="RightClixs" value={name} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <Button type="submit" loading={create.isPending} className="w-full">
          Create workspace
        </Button>
      </form>

      <div className="mt-6 flex items-center justify-between gap-3 text-sm">
        {hasWorkspace ? (
          <Link href="/clients" className="font-semibold text-primary-text underline-offset-4 hover:underline">
            Back to {me.data.workspace?.name ?? "my workspace"}
          </Link>
        ) : (
          <span className="text-muted">Signed in as {me.data.user.email}</span>
        )}
        <button
          type="button"
          onClick={() => logout.mutate()}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg px-2 font-medium text-muted hover:text-fg"
        >
          <LogOut className="size-4" aria-hidden="true" />
          Sign out
        </button>
      </div>
    </div>
  );
}
