export function MarketDetailRightSidebarSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Market Stats Skeleton */}
      <div className="bg-secondary/20 rounded-xl p-6 border border-border">
        <div className="flex items-center gap-2 mb-4">
          <div className="h-5 w-5 bg-gray-300 dark:bg-gray-700 rounded" />
          <div className="h-5 w-32 bg-gray-300 dark:bg-gray-700 rounded" />
        </div>
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex justify-between items-center">
              <div className="h-4 w-24 bg-gray-300 dark:bg-gray-700 rounded" />
              <div className="h-4 w-16 bg-gray-300 dark:bg-gray-700 rounded" />
            </div>
          ))}
          <div className="h-px bg-border my-2" />
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex justify-between items-center">
              <div className="h-4 w-20 bg-gray-300 dark:bg-gray-700 rounded" />
              <div className="h-4 w-20 bg-gray-300 dark:bg-gray-700 rounded" />
            </div>
          ))}
        </div>
      </div>

      {/* Creator Info Skeleton */}
      <div className="bg-secondary/20 rounded-xl p-6 border border-border">
        <div className="h-5 w-32 bg-gray-300 dark:bg-gray-700 rounded mb-4" />
        <div className="flex items-center gap-3 mb-4">
          <div className="h-12 w-12 rounded-full bg-gray-300 dark:bg-gray-700" />
          <div>
            <div className="h-4 w-24 bg-gray-300 dark:bg-gray-700 rounded mb-2" />
            <div className="h-3 w-20 bg-gray-300 dark:bg-gray-700 rounded" />
          </div>
        </div>
        <div className="space-y-2">
          <div className="h-3 w-full bg-gray-300 dark:bg-gray-700 rounded" />
          <div className="h-3 w-full bg-gray-300 dark:bg-gray-700 rounded" />
          <div className="h-3 w-3/4 bg-gray-300 dark:bg-gray-700 rounded" />
        </div>
      </div>
    </div>
  );
}
