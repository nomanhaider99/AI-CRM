import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Create account" };

export default function Page() {
  // AuthForm reads ?next=, which needs a Suspense boundary for static rendering.
  return (
    <Suspense>
      <AuthForm mode="signup" />
    </Suspense>
  );
}
