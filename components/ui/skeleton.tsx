import type { HTMLAttributes } from "react";
import { cx } from "@/utils/cx";

/** Loading placeholder. Untitled UI has no free skeleton — this matches its tokens. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("bg-tertiary animate-pulse rounded-md", className)} {...props} />;
}

/** Line skeleton for text blocks: `width` as a Tailwind class. */
export function SkeletonText({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <Skeleton className={cx("h-4 w-full", className)} {...props} />;
}
