import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "@/utils/cx";

/** Surface container used across admin pages. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx("bg-primary border-tertiary rounded-xl border shadow-xs", className)}
      {...props}
    />
  );
}

export function CardHeader({
  children,
  actions,
  className,
}: {
  children: ReactNode;
  /** Right-aligned controls (buttons, filters). */
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "border-tertiary flex items-start justify-between gap-4 border-b px-6 py-4",
        className,
      )}
    >
      <div className="min-w-0">{children}</div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h3 className={cx("text-md text-primary font-semibold", className)}>{children}</h3>;
}

export function CardDescription({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <p className={cx("text-secondary text-sm", className)}>{children}</p>;
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("p-6", className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        "border-tertiary flex items-center justify-end gap-3 border-t px-6 py-4",
        className,
      )}
      {...props}
    />
  );
}
