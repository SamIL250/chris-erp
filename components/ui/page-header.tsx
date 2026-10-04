import type { ReactNode } from "react";

/**
 * Standard page title block: heading + description + right-aligned actions.
 * Every admin page starts with this for visual consistency.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-display-sm text-primary font-semibold">{title}</h1>
        {description ? <p className="text-md text-secondary mt-1">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
    </div>
  );
}
