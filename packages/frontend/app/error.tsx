"use client";

import Link from "next/link";
import { useEffect } from "react";

type AppErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function AppError({ error, reset }: AppErrorProps) {
  useEffect(() => {
    console.error("Application error boundary caught an error:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <h1 className="text-2xl font-bold tracking-tight">Something went wrong</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          We&apos;re sorry, an unexpected error occurred. Please try again or
          return to the home page.
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
          >
            Try Again
          </button>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
          >
            Return Home
          </Link>
        </div>
      </div>
    </div>
  );
}
