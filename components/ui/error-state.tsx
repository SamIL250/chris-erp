import { X } from "@untitledui/icons";
import type { ReactNode } from "react";
import { Button } from "@/components/base/buttons/button";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { cx } from "@/utils/cx";

/**
 * Centered error/404 state (PH0-16): icon, copy, retry + back actions.
 * Used by `app/error.tsx`, `app/(admin)/error.tsx` and `app/not-found.tsx`.
 */
export function ErrorState({
  title,
  description,
  onRetry,
  backHref,
  backLabel,
  children,
  className,
}: {
  title: string;
  description?: string;
  /** Renders a primary "Try again" button (error boundaries pass `reset`). */
  onRetry?: () => void;
  /** Renders a secondary back link. */
  backHref?: string;
  backLabel?: string;
  /** Extra actions rendered between the retry and back buttons. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex flex-col items-center justify-center gap-5 px-4 py-16 text-center",
        className,
      )}
    >
      <FeaturedIcon color="error" size="xl" icon={X} />
      <div className="max-w-lg space-y-2">
        <h1 className="text-display-xs text-primary font-semibold">{title}</h1>
        {description ? <p className="text-md text-secondary">{description}</p> : null}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        {onRetry ? (
          <Button color="primary" size="lg" onPress={onRetry}>
            Try again
          </Button>
        ) : null}
        {children}
        {backHref ? (
          <Button color="secondary" size="lg" href={backHref}>
            {backLabel ?? "Go back"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
