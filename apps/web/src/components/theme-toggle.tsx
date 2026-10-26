"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ThemePreference } from "@/lib/theme";
import { setThemePreference, useThemePreference } from "@/lib/theme";

const options: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/** Light / dark / system as a radio group, so the current choice is announced and keyboard-selectable. */
export function ThemeToggle({ className }: { className?: string }) {
  const current = useThemePreference();
  return (
    <div role="radiogroup" aria-label="Color theme" className={cn("glass inline-flex rounded-xl p-1", className)}>
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={current === value}
          aria-label={label}
          title={label}
          onClick={() => setThemePreference(value)}
          className={cn(
            "inline-flex size-9 items-center justify-center rounded-lg transition-colors duration-150",
            current === value ? "bg-primary text-on-primary shadow-sm" : "text-muted hover:bg-primary-soft hover:text-fg",
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
