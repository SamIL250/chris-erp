"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { VendorHeader } from "@/components/procurement/vendor-header";
import { VendorProducts } from "@/components/procurement/vendor-products";
import { VendorStatement } from "@/components/procurement/vendor-statement";
import { usePageLabel } from "@/components/shared/page-label";
import { FormAlert } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCan } from "@/hooks/use-can";
import { paymentTermsLabel } from "@/lib/customers";
import { toUserMessage } from "@/lib/errors";
import { licenseExpiryInput } from "@/lib/vendors";

/**
 * One vendor (PH2-03): the company, its people, and remit-to and
 * ship-from addresses, the products it supplies, and the statement
 * of receipts that name it (PH2-05).
 */
export function VendorDetail({ vendorId }: { vendorId: string }) {
  const canEdit = useCan("procurement", "edit");
  const detail = useQuery(api.procurement.vendors.get, {
    vendorId: vendorId as Id<"vendors">,
  });
  const options = useQuery(api.procurement.vendors.options, {});
  usePageLabel(detail?.vendor.name);

  if (detail === undefined || options === undefined) return <Skeleton className="h-96" />;
  if (detail === null) {
    return <PageHeader title="Vendor not found" description="That vendor is not in the master." />;
  }

  const { vendor } = detail;
  const license =
    vendor.licenseNumber === undefined
      ? null
      : vendor.licenseExpiresOn === undefined
        ? vendor.licenseNumber
        : `${vendor.licenseNumber} · ${licenseExpiryInput(vendor.licenseExpiresOn)}`;
  return (
    <div className="space-y-8">
      <PageHeader
        title={vendor.name}
        description={`${vendor.code} · ${paymentTermsLabel(vendor.paymentTermsDays)} · ${vendor.currency}${license ? ` · ${license}` : ""}`}
        actions={
          <Badge color={vendor.active ? "success" : "gray"} size="md">
            {vendor.active ? "Active" : "Inactive"}
          </Badge>
        }
      />

      <VendorStatement vendorId={vendor._id} />

      <section className="bg-primary ring-primary space-y-4 rounded-xl p-5 ring-1">
        <h2 className="text-primary text-md font-semibold">Company</h2>
        <VendorHeader
          key={`${vendor.updatedAt}`}
          vendor={vendor}
          options={options}
          canSave={canEdit}
        />
      </section>

      <Contacts vendorId={vendor._id} contacts={detail.contacts} canEdit={canEdit} />
      <Addresses vendorId={vendor._id} addresses={detail.addresses} canEdit={canEdit} />
      <VendorProducts vendorId={vendor._id} />
    </div>
  );
}

function Contacts({
  vendorId,
  contacts,
  canEdit,
}: {
  vendorId: Id<"vendors">;
  contacts: {
    _id: Id<"vendorContacts">;
    name: string;
    email?: string;
    phone?: string;
    jobTitle?: string;
    isPrimary: boolean;
  }[];
  canEdit: boolean;
}) {
  const add = useMutation(api.procurement.vendors.addContact);
  const remove = useMutation(api.procurement.vendors.removeContact);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      await add({ vendorId, name, email, isPrimary: contacts.length === 0 });
      setName("");
      setEmail("");
      toast.success("Contact added");
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <h2 className="text-primary text-md font-semibold">Contacts</h2>
      {error ? <FormAlert title="Couldn't save the contact" message={error} /> : null}
      {contacts.length === 0 ? (
        <p className="text-tertiary text-sm">No contacts yet.</p>
      ) : (
        <ul className="divide-secondary divide-y">
          {contacts.map((row) => (
            <li key={row._id} className="flex items-center justify-between gap-3 py-3">
              <div>
                <p className="text-primary text-sm font-medium">
                  {row.name}
                  {row.isPrimary ? (
                    <span className="text-tertiary font-normal"> · Primary</span>
                  ) : null}
                </p>
                <p className="text-tertiary text-sm">
                  {[row.jobTitle, row.email, row.phone].filter(Boolean).join(" · ") || "—"}
                </p>
              </div>
              {canEdit ? (
                <Button
                  size="sm"
                  color="tertiary"
                  onPress={() =>
                    void remove({ contactId: row._id }).then(() => toast.success("Contact removed"))
                  }
                >
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Input label="Name" value={name} onChange={setName} />
          <Input label="Email" value={email} onChange={setEmail} />
          <Button color="secondary" isLoading={busy} onPress={() => void save()}>
            Add contact
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function Addresses({
  vendorId,
  addresses,
  canEdit,
}: {
  vendorId: Id<"vendors">;
  addresses: {
    _id: Id<"vendorAddresses">;
    line1: string;
    line2?: string;
    city: string;
    region?: string;
    postalCode?: string;
    country: string;
    isDefaultRemit: boolean;
    isDefaultShip: boolean;
  }[];
  canEdit: boolean;
}) {
  const add = useMutation(api.procurement.vendors.addAddress);
  const remove = useMutation(api.procurement.vendors.removeAddress);
  const [line1, setLine1] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const none = addresses.length === 0;

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      await add({
        vendorId,
        line1,
        city,
        country,
        isDefaultRemit: none,
        isDefaultShip: none,
      });
      setLine1("");
      setCity("");
      setCountry("");
      toast.success("Address added");
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <h2 className="text-primary text-md font-semibold">Addresses</h2>
      {error ? <FormAlert title="Couldn't save the address" message={error} /> : null}
      {addresses.length === 0 ? (
        <p className="text-tertiary text-sm">
          No addresses yet. The first one is the default remit-to and ship-from.
        </p>
      ) : (
        <ul className="divide-secondary divide-y">
          {addresses.map((row) => (
            <li key={row._id} className="flex items-center justify-between gap-3 py-3">
              <div>
                <p className="text-primary text-sm font-medium">
                  {row.line1}, {row.city}
                </p>
                <p className="text-tertiary text-sm">
                  {[row.region, row.postalCode, row.country].filter(Boolean).join(" · ")}
                  {row.isDefaultRemit ? " · Default remit-to" : ""}
                  {row.isDefaultShip ? " · Default ship-from" : ""}
                </p>
              </div>
              {canEdit ? (
                <Button
                  size="sm"
                  color="tertiary"
                  onPress={() =>
                    void remove({ addressId: row._id }).then(() => toast.success("Address removed"))
                  }
                >
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canEdit ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          <Input label="Line 1" value={line1} onChange={setLine1} />
          <Input label="City" value={city} onChange={setCity} />
          <Input label="Country" value={country} onChange={setCountry} />
          <Button color="secondary" isLoading={busy} onPress={() => void save()}>
            Add address
          </Button>
        </div>
      ) : null}
    </section>
  );
}
