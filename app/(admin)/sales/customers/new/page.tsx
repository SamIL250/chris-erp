"use client";

import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { CustomerHeader } from "@/components/sales/customer-header";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import { useCan } from "@/hooks/use-can";

/** Create a customer (PH2-01). Contacts and addresses are added on the company page. */
export default function NewCustomerPage() {
  const router = useRouter();
  const canCreate = useCan("sales", "create");
  const options = useQuery(api.sales.customers.options, {});

  return (
    <div className="space-y-6">
      <PageHeader
        title="New customer"
        description="The company account. People, addresses, and notes come next."
      />
      {options === undefined ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="bg-primary ring-primary rounded-xl p-5 ring-1">
          <CustomerHeader
            customer={null}
            options={options}
            canSave={canCreate}
            onCreated={(id) => router.push(`/sales/customers/${id}`)}
          />
        </div>
      )}
    </div>
  );
}
