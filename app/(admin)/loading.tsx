import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-level loading UI for admin navigations (PH0-16): shown while a page
 * segment suspends (Convex queries resolving) — keeps the shell stable and
 * avoids layout jumps. Page-specific skeletons can be added below a route
 * when a section needs one.
 */
export default function AdminLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-36" />
        <Skeleton className="h-36" />
        <Skeleton className="h-36" />
        <Skeleton className="h-36" />
        <Skeleton className="h-36" />
        <Skeleton className="h-36" />
      </div>
    </div>
  );
}
