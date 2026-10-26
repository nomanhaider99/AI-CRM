import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Sign in" };

export default function Page() {
  // AuthForm reads ?next=, which needs a Suspense boundary for static rendering.
  return (
    <Suspense>
      <AuthForm mode="login" />
    </Suspense>
  );
}
