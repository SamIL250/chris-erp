"use client";

import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { VendorHeader } from "@/components/procurement/vendor-header";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import { useCan } from "@/hooks/use-can";

/** Create a vendor (PH2-03). Contacts and addresses are added on the company page. */
export default function NewVendorPage() {
  const router = useRouter();
  const canCreate = useCan("procurement", "create");
  const options = useQuery(api.procurement.vendors.options, {});

  return (
    <div className="space-y-6">
      <PageHeader
        title="New vendor"
        description="The company you buy from. People and addresses come next."
      />
      {options === undefined ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="bg-primary ring-primary rounded-xl p-5 ring-1">
          <VendorHeader
            vendor={null}
            options={options}
            canSave={canCreate}
            onCreated={(id) => router.push(`/procurement/vendors/${id}`)}
          />
        </div>
      )}
    </div>
  );
}
