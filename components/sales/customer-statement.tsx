"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { documentKindLabel, type CustomerDocumentKind } from "@/lib/statements";

function documentHref(kind: CustomerDocumentKind, id: string): string | null {
  switch (kind) {
    case "quote":
      return `/sales/quotes/${id}`;
    case "salesOrder":
      return `/sales/orders/${id}`;
    case "delivery":
      return `/sales/deliveries/${id}`;
    case "invoice":
      return `/sales/invoices/${id}`;
    case "creditNote":
      return `/sales/credit-notes/${id}`;
    case "salesReturn":
      return `/sales/returns/${id}`;
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Balance and the documents that will make it up (PH2-05). */
export function CustomerStatement({ customerId }: { customerId: Id<"customers"> }) {
  const statement = useQuery(api.sales.customers.statement, { customerId });
  if (statement === undefined || statement === null) return null;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-primary text-md font-semibold">Statement</h2>
        <p className="text-tertiary text-sm">
          A posted or paid invoice raises the balance. A posted credit note lowers it. A return is
          listed and does not change the balance until that credit note posts. Payments are not
          recorded yet, so marking an invoice paid leaves the balance as it is. Quotes, orders,
          deliveries, and drafts are listed and do not change the balance.
        </p>
      </div>
      <dl className="grid gap-4 sm:grid-cols-4">
        <div>
          <dt className="text-tertiary text-sm">Currency</dt>
          <dd className="text-primary text-sm font-medium">{statement.currency}</dd>
        </div>
        <div>
          <dt className="text-tertiary text-sm">Credit limit</dt>
          <dd className="text-primary text-sm font-medium tabular-nums">
            {statement.creditLimit === null ? "No cap" : money(statement.creditLimit)}
          </dd>
        </div>
        <div>
          <dt className="text-tertiary text-sm">Balance</dt>
          <dd className="text-primary text-sm font-medium tabular-nums">
            {money(statement.balance)}
          </dd>
        </div>
        <div>
          <dt className="text-tertiary text-sm">Available</dt>
          <dd className="text-primary text-sm font-medium tabular-nums">
            {statement.available === null ? "No cap" : money(statement.available)}
          </dd>
        </div>
      </dl>
      <div>
        <h3 className="text-primary text-sm font-semibold">Documents</h3>
        {statement.documents.length === 0 ? (
          <p className="text-tertiary mt-1 text-sm">No documents yet. Invoices will list here.</p>
        ) : (
          <ul className="divide-secondary mt-2 divide-y">
            {statement.documents.map((row) => {
              const href = documentHref(row.kind, row.id);
              const label = `${documentKindLabel(row.kind)} ${row.number}`;
              return (
                <li key={row.id} className="flex items-center justify-between gap-3 py-3">
                  {href === null ? (
                    <p className="text-primary text-sm">{label}</p>
                  ) : (
                    <Link href={href} className="text-primary text-sm font-medium">
                      {label}
                    </Link>
                  )}
                  <p className="text-secondary text-sm tabular-nums">{money(row.amount)}</p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
