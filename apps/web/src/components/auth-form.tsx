"use client";

import { loginSchema, signupSchema } from "@crm/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, Input } from "@/components/ui/field";
import type { FieldErrors } from "@/lib/api";
import { api, isApiError } from "@/lib/api";
import { queryKeys, useMe } from "@/lib/queries";
import { safeNext } from "@/lib/redirect";
import type { User, Workspace } from "@/lib/types";
import { validate } from "@/lib/validation";

type Mode = "login" | "signup";

const copy: Record<Mode, { title: string; subtitle: string; submit: string }> = {
  login: { title: "Welcome back", subtitle: "Sign in to your workspace.", submit: "Sign in" },
  signup: { title: "Create your account", subtitle: "Start with the free plan. No card needed.", submit: "Create account" },
};

export function AuthForm({ mode }: { mode: Mode }) {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const next = safeNext(params.get("next"));
  const [values, setValues] = useState({ name: "", email: "", password: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [showPassword, setShowPassword] = useState(false);

  // Already signed in: skip the form.
  const me = useMe();
  useEffect(() => {
    if (me.data) router.replace(me.data.workspace ? next : "/onboarding");
  }, [me.data, next, router]);

  const submit = useMutation({
    mutationFn: (body: unknown) => api<{ user: User; workspace: Workspace | null }>(`/auth/${mode}`, { method: "POST", body }),
    onSuccess: async (res) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.me });
      router.replace(res.workspace ? next : "/onboarding");
    },
    onError: (err) => {
      if (isApiError(err)) setErrors(err.fieldErrors);
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const input = mode === "signup" ? values : { email: values.email, password: values.password };
    const result = validate(mode === "signup" ? signupSchema : loginSchema, input);
    setErrors(result.errors ?? {});
    if (result.errors) {
      // Focus the first invalid field so keyboard and screen-reader users land on the problem.
      const first = Object.keys(result.errors)[0];
      document.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();
      return;
    }
    submit.mutate(result.data);
  }

  const set = (key: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [key]: e.target.value }));
  const serverError = submit.error && Object.keys(errors).length === 0 ? submit.error.message : null;
  const c = copy[mode];

  return (
    <div className="glass w-full max-w-md rounded-3xl p-6 sm:p-8">
      <h1 className="text-2xl font-bold tracking-tight text-fg">{c.title}</h1>
      <p className="mt-1 text-sm text-muted">{c.subtitle}</p>

      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
        {serverError && <Alert>{serverError}</Alert>}

        {mode === "signup" && (
          <Field label="Full name" error={errors.name} required>
            {(p) => <Input {...p} name="name" autoComplete="name" value={values.name} onChange={set("name")} />}
          </Field>
        )}
        <Field label="Email" error={errors.email} required>
          {(p) => <Input {...p} name="email" type="email" inputMode="email" autoComplete="email" value={values.email} onChange={set("email")} />}
        </Field>
        <Field label="Password" error={errors.password} hint={mode === "signup" ? "At least 8 characters." : undefined} required>
          {(p) => (
            <div className="relative">
              <Input
                {...p}
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                value={values.password}
                onChange={set("password")}
                className="pr-12"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-muted hover:text-fg"
              >
                {showPassword ? <EyeOff className="size-4.5" aria-hidden="true" /> : <Eye className="size-4.5" aria-hidden="true" />}
              </button>
            </div>
          )}
        </Field>

        <Button type="submit" loading={submit.isPending} className="w-full">
          {c.submit}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        {mode === "login" ? "New here? " : "Already have an account? "}
        <Link
          href={{ pathname: mode === "login" ? "/signup" : "/login", query: params.get("next") ? { next } : {} }}
          className="font-semibold text-primary-text underline-offset-4 hover:underline"
        >
          {mode === "login" ? "Create an account" : "Sign in"}
        </Link>
      </p>
    </div>
  );
}
