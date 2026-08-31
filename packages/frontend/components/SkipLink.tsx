"use client";

import { cn } from "@/lib/utils";

/**
 * Skip-to-content link for keyboard and screen reader users.
 * Visually hidden until focused, then revealed so users can bypass
 * the primary navigation and jump straight to the main content.
 */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      className={cn(
        "sr-only focus:not-sr-only",
        "fixed left-4 top-4 z-[100]",
        "rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground",
        "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
      )}
    >
      Skip to content
    </a>
  );
}
