"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui/error-state";

/**
 * Admin error boundary (PH0-16): renders inside the shell, so navigation and
 * the account menu stay available while a page fails.
 */
export default function AdminError({
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
      title="This page failed to load"
      description="Something went wrong rendering this page. Your session is unaffected — try again, or head back to the dashboard."
      onRetry={reset}
      backHref="/dashboard"
      backLabel="Back to dashboard"
    />
  );
}
