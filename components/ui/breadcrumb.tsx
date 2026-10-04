import { ChevronRight } from "@untitledui/icons";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";

export interface BreadcrumbItem {
  label: string;
  /** Omit on the last item — it renders as the current page. */
  href?: string;
}

/** Breadcrumb trail. Untitled UI free tier has no plain breadcrumb — built on its tokens. */
export function Breadcrumb({ items, className }: { items: BreadcrumbItem[]; className?: string }) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1">
              {index > 0 ? <ChevronRight className="text-tertiary size-4" aria-hidden /> : null}
              {item.href && !isLast ? (
                <Link
                  href={item.href}
                  className="text-secondary hover:text-primary rounded-xs transition-colors hover:underline"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  className="text-primary font-medium"
                  aria-current={isLast ? "page" : undefined}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Convenience: renders a Breadcrumb + PageHeader pair (the standard admin page top). */
export function PageTop({
  breadcrumb,
  title,
  description,
  actions,
}: {
  breadcrumb?: BreadcrumbItem[];
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      {breadcrumb ? <Breadcrumb items={breadcrumb} /> : null}
      <PageHeader title={title} description={description} actions={actions} />
    </div>
  );
}
