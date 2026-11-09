"use client";

import { ChevronRight } from "@untitledui/icons";
import { useQuery } from "convex/react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { salesDocFlowSteps, type DocFlowStep } from "@/lib/docFlow";

export type { DocFlowStep };

/**
 * Linked documents for one sale (PH2-27). A later step with no href
 * is still named, so the trail shows what has not been opened. The
 * current page is not a link.
 */
export function DocFlow({ steps }: { steps: DocFlowStep[] }) {
  if (steps.length === 0) return null;
  return (
    <nav aria-label="Documents">
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        {steps.map((step, index) => {
          const linked = step.href !== undefined && step.current !== true;
          return (
            <li key={`${step.label}-${index}`} className="flex items-center gap-1">
              {index > 0 ? (
                <ChevronRight className="text-fg-quaternary size-4 shrink-0" aria-hidden="true" />
              ) : null}
              {linked ? (
                <Link
                  href={step.href ?? ""}
                  className="text-secondary hover:text-primary rounded-xs transition-colors hover:underline"
                >
                  {step.label}
                </Link>
              ) : (
                <span
                  className={step.current ? "text-primary font-medium" : "text-tertiary"}
                  aria-current={step.current ? "page" : undefined}
                >
                  {step.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

type SalesDocFlowProps =
  | { quoteId: Id<"quotes"> }
  | { salesOrderId: Id<"salesOrders"> }
  | { deliveryId: Id<"deliveries"> }
  | { invoiceId: Id<"salesInvoices"> }
  | { creditNoteId: Id<"creditNotes"> }
  | { salesReturnId: Id<"salesReturns"> };

/** The quote → order → delivery → invoice → payment trail for this document. */
export function SalesDocFlow(props: SalesDocFlowProps) {
  const flow = useQuery(api.sales.docFlow.get, props);
  if (flow === undefined) return <Skeleton className="h-5 w-80" />;
  if (flow === null) return null;
  return <DocFlow steps={salesDocFlowSteps(flow)} />;
}
