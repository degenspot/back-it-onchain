export function MarketDetailSkeleton() {
  return (
    <div className="animate-pulse">
      {/* Header Skeleton */}
      <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-md border-b border-border px-4 py-3 flex items-center gap-4">
        <div className="h-10 w-10 bg-gray-300/70 dark:bg-gray-700/70 rounded-full" />
        <div className="flex-1">
          <div className="h-5 w-32 bg-gray-300/70 dark:bg-gray-700/70 rounded mb-1.5" />
          <div className="h-3 w-24 bg-gray-300/70 dark:bg-gray-700/70 rounded" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-10 w-10 bg-gray-300/70 dark:bg-gray-700/70 rounded-full" />
          <div className="h-10 w-10 bg-gray-300/70 dark:bg-gray-700/70 rounded-full" />
        </div>
      </header>

      <div className="p-6">
        {/* Price Chart Skeleton */}
        <section className="mb-8">
          <div className="bg-card border border-border rounded-xl p-6">
            <div className="h-6 w-48 bg-gray-300/70 dark:bg-gray-700/70 rounded mb-4" />
            <div className="h-64 bg-gray-300/70 dark:bg-gray-700/70 rounded-lg" />
          </div>
        </section>

        {/* Call Header Info Skeleton */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-10 w-10 rounded-full bg-gray-300/70 dark:bg-gray-700/70" />
            <div>
              <div className="h-4 w-32 bg-gray-300/70 dark:bg-gray-700/70 rounded mb-1.5" />
              <div className="h-3 w-40 bg-gray-300/70 dark:bg-gray-700/70 rounded" />
            </div>
          </div>

          <div className="space-y-2 mb-4">
            <div className="h-7 w-full bg-gray-300/70 dark:bg-gray-700/70 rounded" />
            <div className="h-7 w-2/3 bg-gray-300/70 dark:bg-gray-700/70 rounded" />
          </div>

          <div className="flex flex-wrap gap-3 mb-6">
            <div className="h-9 w-36 bg-gray-300/70 dark:bg-gray-700/70 rounded-lg" />
            <div className="h-9 w-32 bg-gray-300/70 dark:bg-gray-700/70 rounded-lg" />
            <div className="h-9 w-40 bg-gray-300/70 dark:bg-gray-700/70 rounded-lg" />
          </div>
        </div>

        {/* Thesis Section Skeleton */}
        <section className="mb-8">
          <div className="bg-gradient-to-br from-secondary/50 to-secondary/20 rounded-xl p-6 border border-border">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-5 w-5 bg-gray-300/70 dark:bg-gray-700/70 rounded" />
              <div className="h-4 w-32 bg-gray-300/70 dark:bg-gray-700/70 rounded" />
            </div>
            <div className="space-y-3">
              <div className="h-5 w-full bg-gray-300/70 dark:bg-gray-700/70 rounded" />
              <div className="h-5 w-full bg-gray-300/70 dark:bg-gray-700/70 rounded" />
              <div className="h-5 w-4/5 bg-gray-300/70 dark:bg-gray-700/70 rounded" />
            </div>
            <div className="mt-4 pt-4 border-t border-border/50 flex items-center gap-4">
              <div className="h-4 w-28 bg-gray-300/70 dark:bg-gray-700/70 rounded" />
              <div className="h-4 w-36 bg-gray-300/70 dark:bg-gray-700/70 rounded" />
            </div>
          </div>
        </section>

        {/* Action Buttons Skeleton */}
        <section className="mb-8">
          <div className="grid grid-cols-2 gap-4">
            <div className="h-24 bg-gray-300/70 dark:bg-gray-700/70 rounded-xl" />
            <div className="h-24 bg-gray-300/70 dark:bg-gray-700/70 rounded-xl" />
          </div>
        </section>

        {/* Activity Log Skeleton */}
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-5 w-5 bg-gray-300/70 dark:bg-gray-700/70 rounded" />
            <div className="h-6 w-40 bg-gray-300/70 dark:bg-gray-700/70 rounded" />
          </div>
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-card border border-border rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-gray-300/70 dark:bg-gray-700/70" />
                  <div className="flex-1">
                    <div className="h-4 w-48 bg-gray-300/70 dark:bg-gray-700/70 rounded mb-2" />
                    <div className="h-3 w-32 bg-gray-300/70 dark:bg-gray-700/70 rounded" />
                  </div>
                  <div className="h-6 w-16 bg-gray-300/70 dark:bg-gray-700/70 rounded" />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Interaction Stats Skeleton */}
        <div className="flex items-center justify-between border-y border-border py-4">
          <div className="flex gap-6">
            <div className="h-5 w-28 bg-gray-300/70 dark:bg-gray-700/70 rounded" />
            <div className="h-5 w-32 bg-gray-300/70 dark:bg-gray-700/70 rounded" />
          </div>
        </div>
      </div>
    </div>
  );
}
