"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/error-state";

/** Root error boundary (PH0-16): catches page/layout errors anywhere. */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorState
      title="Something went wrong"
      description="An unexpected error occurred while loading this page. Try again — if it keeps happening, the Convex logs will have details."
      onRetry={reset}
      backHref="/dashboard"
      backLabel="Back to dashboard"
    />
  );
}
