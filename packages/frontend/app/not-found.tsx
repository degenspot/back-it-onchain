import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background px-6">
      <main className="mx-auto flex min-h-screen w-full max-w-xl items-center justify-center">
        <div className="w-full rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
            404
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight">
            This page could not be found
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            The market or page you&apos;re looking for may have moved, expired,
            or never existed.
          </p>

          <div className="mt-6 flex justify-center">
            <Link
              href="/feed"
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
            >
              Return to Feed
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
