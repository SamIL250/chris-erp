"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { TextArea } from "@/components/base/textarea/textarea";
import { CustomerHeader } from "@/components/sales/customer-header";
import { CustomerStatement } from "@/components/sales/customer-statement";
import { CustomerPrices } from "@/components/sales/stored-price-table";
import { usePageLabel } from "@/components/shared/page-label";
import { FormAlert } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCan } from "@/hooks/use-can";
import { customerStatusLabel, paymentTermsLabel } from "@/lib/customers";
import { toUserMessage } from "@/lib/errors";
import { formatWhen } from "@/lib/inventory-display";

/**
 * One customer (PH2-01): the company, its people, bill-to and ship-to
 * addresses, and the notes timeline. The statement (PH2-05) is the
 * balance and the documents that post to it.
 */
export function CustomerDetail({ customerId }: { customerId: string }) {
  const canEdit = useCan("sales", "edit");
  const detail = useQuery(api.sales.customers.get, {
    customerId: customerId as Id<"customers">,
  });
  const options = useQuery(api.sales.customers.options, {});
  usePageLabel(detail?.customer.name);

  if (detail === undefined || options === undefined) return <Skeleton className="h-96" />;
  if (detail === null) {
    return (
      <PageHeader title="Customer not found" description="That customer is not in the master." />
    );
  }

  const { customer } = detail;
  return (
    <div className="space-y-8">
      <PageHeader
        title={customer.name}
        description={`${customer.code} · ${paymentTermsLabel(customer.paymentTermsDays)} · ${customer.currency}${detail.group ? ` · ${detail.group.name}` : ""}`}
        actions={
          <Badge
            color={
              customer.status === "active"
                ? "success"
                : customer.status === "onHold"
                  ? "error"
                  : "gray"
            }
            size="md"
          >
            {customerStatusLabel(customer.status)}
          </Badge>
        }
      />

      <CustomerStatement customerId={customer._id} />
      <CustomerPrices
        customerId={customer._id}
        status={customer.status}
        currency={customer.currency}
      />

      <section className="bg-primary ring-primary space-y-4 rounded-xl p-5 ring-1">
        <h2 className="text-primary text-md font-semibold">Company</h2>
        <CustomerHeader
          key={`${customer.updatedAt}`}
          customer={customer}
          options={options}
          canSave={canEdit}
        />
      </section>

      <Contacts customerId={customer._id} contacts={detail.contacts} canEdit={canEdit} />
      <Addresses customerId={customer._id} addresses={detail.addresses} canEdit={canEdit} />
      <Notes customerId={customer._id} notes={detail.notes} canEdit={canEdit} />
    </div>
  );
}

function Contacts({
  customerId,
  contacts,
  canEdit,
}: {
  customerId: Id<"customers">;
  contacts: {
    _id: Id<"customerContacts">;
    name: string;
    email?: string;
    phone?: string;
    jobTitle?: string;
    isPrimary: boolean;
  }[];
  canEdit: boolean;
}) {
  const add = useMutation(api.sales.customers.addContact);
  const remove = useMutation(api.sales.customers.removeContact);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      await add({ customerId, name, email, isPrimary: contacts.length === 0 });
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
  customerId,
  addresses,
  canEdit,
}: {
  customerId: Id<"customers">;
  addresses: {
    _id: Id<"customerAddresses">;
    line1: string;
    line2?: string;
    city: string;
    region?: string;
    postalCode?: string;
    country: string;
    isDefaultBill: boolean;
    isDefaultShip: boolean;
  }[];
  canEdit: boolean;
}) {
  const add = useMutation(api.sales.customers.addAddress);
  const remove = useMutation(api.sales.customers.removeAddress);
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
        customerId,
        line1,
        city,
        country,
        isDefaultBill: none,
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
          No addresses yet. The first one is the default bill-to and ship-to.
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
                  {row.isDefaultBill ? " · Default bill-to" : ""}
                  {row.isDefaultShip ? " · Default ship-to" : ""}
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

function Notes({
  customerId,
  notes,
  canEdit,
}: {
  customerId: Id<"customers">;
  notes: { _id: Id<"customerNotes">; body: string; createdAt: number; author: string }[];
  canEdit: boolean;
}) {
  const add = useMutation(api.sales.customers.addNote);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      await add({ customerId, body });
      setBody("");
      toast.success("Note added");
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <h2 className="text-primary text-md font-semibold">Notes</h2>
      {error ? <FormAlert title="Couldn't save the note" message={error} /> : null}
      {notes.length === 0 ? (
        <p className="text-tertiary text-sm">No notes yet. Each note stays on the timeline.</p>
      ) : (
        <ol className="space-y-3">
          {notes.map((note) => (
            <li key={note._id} className="bg-primary ring-primary rounded-xl p-4 ring-1">
              <p className="text-primary text-sm whitespace-pre-wrap">{note.body}</p>
              <p className="text-tertiary mt-2 text-xs">
                {note.author} · {formatWhen(note.createdAt)}
              </p>
            </li>
          ))}
        </ol>
      )}
      {canEdit ? (
        <div className="space-y-3">
          <TextArea label="New note" value={body} onChange={setBody} rows={3} />
          <div className="flex justify-end">
            <Button color="secondary" isLoading={busy} onPress={() => void save()}>
              Add note
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
