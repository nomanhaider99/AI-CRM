import { Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 font-bold tracking-tight text-fg", className)}>
      <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[#0ea5e9] text-white shadow-md shadow-primary/30">
        <Sparkles className="size-5" aria-hidden="true" />
      </span>
      <span className="text-lg">AI CRM</span>
    </span>
  );
}
