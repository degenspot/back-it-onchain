import { Skeleton } from './ui/Skeleton';

/** Loading placeholder for the profile view (FE-25). */
export function ProfileSkeleton() {
  return (
    <div data-testid="profile-skeleton" className="space-y-6">
      <div className="flex items-center gap-4 rounded-2xl border border-border bg-card p-6">
        <Skeleton className="h-16 w-16 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-5">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="mt-2 h-8 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
