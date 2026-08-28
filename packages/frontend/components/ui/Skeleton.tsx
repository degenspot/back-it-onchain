import { cn } from '@/lib/utils';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {}

/**
 * Base skeleton primitive (FE-25). All loading placeholders reuse this so
 * shimmer styling is defined in a single place.
 */
export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-pulse rounded-md bg-gray-300/70 dark:bg-gray-700/70',
        className,
      )}
      {...props}
    />
  );
}
