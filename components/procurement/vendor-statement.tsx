"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatWhen } from "@/lib/inventory-display";

function money(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Receipts that name this vendor, and what they cost (PH2-05). */
export function VendorStatement({ vendorId }: { vendorId: Id<"vendors"> }) {
  const statement = useQuery(api.procurement.vendors.statement, { vendorId });
  if (statement === undefined || statement === null) return null;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-primary text-md font-semibold">Statement</h2>
        <p className="text-tertiary text-sm">
          Goods receipts that name this vendor. A line with no unit cost is listed and adds nothing
          to the received total. Bills are not included.
        </p>
      </div>
      <dl className="grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-tertiary text-sm">Currency</dt>
          <dd className="text-primary text-sm font-medium">{statement.currency}</dd>
        </div>
        <div>
          <dt className="text-tertiary text-sm">Receipts</dt>
          <dd className="text-primary text-sm font-medium tabular-nums">
            {statement.receiptCount}
          </dd>
        </div>
        <div>
          <dt className="text-tertiary text-sm">Received</dt>
          <dd className="text-primary text-sm font-medium tabular-nums">
            {money(statement.received)}
          </dd>
        </div>
      </dl>
      <div>
        <h3 className="text-primary text-sm font-semibold">Documents</h3>
        {statement.documents.length === 0 ? (
          <p className="text-tertiary mt-1 text-sm">No receipts name this vendor yet.</p>
        ) : (
          <ul className="divide-secondary mt-2 divide-y">
            {statement.documents.map((row) => (
              <li key={row.receiptId} className="flex items-start justify-between gap-3 py-3">
                <div>
                  <p className="text-primary text-sm font-medium">
                    <a className="hover:underline" href={`/inventory/receipts/${row.receiptId}`}>
                      {row.number}
                    </a>
                    {row.warehouseCode ? ` · ${row.warehouseCode}` : ""}
                  </p>
                  <p className="text-tertiary text-sm">
                    {row.referenceNote} · {formatWhen(row.createdAt)}
                  </p>
                </div>
                <p className="text-secondary text-sm tabular-nums">
                  {row.amount === null ? "—" : money(row.amount)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
