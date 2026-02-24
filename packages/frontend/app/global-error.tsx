"use client";

import Link from "next/link";
import { useEffect } from "react";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error("Global error boundary caught an error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen bg-background px-6">
        <main className="mx-auto flex min-h-screen w-full max-w-xl items-center justify-center">
          <div className="w-full rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
            <h1 className="text-2xl font-bold tracking-tight">
              We hit an unexpected issue
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              Sorry about that. You can try the action again, or return home.
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
        </main>
      </body>
    </html>
  );
}
