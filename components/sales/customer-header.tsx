"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import {
  Form,
  FormActions,
  FormAlert,
  FormInput,
  FormSelect,
  useZodForm,
} from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { toUserMessage } from "@/lib/errors";
import { customerSchema, type CustomerValues } from "@/lib/schemas/customers";

type Options = {
  currencies: { code: string; name: string }[];
  taxGroups: { _id: Id<"taxGroups">; name: string }[];
  customerGroups: { _id: Id<"customerGroups">; name: string; active: boolean }[];
  baseCurrency: string | null;
};

/**
 * Company fields for a customer (PH2-01). Create returns the new id.
 * Save on an existing customer updates that row.
 */
export function CustomerHeader({
  customer,
  options,
  canSave,
  onCreated,
}: {
  customer: Doc<"customers"> | null;
  options: Options | undefined;
  canSave: boolean;
  onCreated?: (id: Id<"customers">) => void;
}) {
  const create = useMutation(api.sales.customers.create);
  const update = useMutation(api.sales.customers.update);
  const [serverError, setServerError] = useState<string | null>(null);
  const methods = useZodForm(customerSchema, {
    defaultValues: {
      code: customer?.code ?? "",
      name: customer?.name ?? "",
      status: customer?.status ?? "active",
      paymentTermsDays: customer ? String(customer.paymentTermsDays) : "0",
      taxGroupId: customer?.taxGroupId ?? "",
      groupId: customer?.groupId ?? "",
      currency: customer?.currency ?? options?.baseCurrency ?? options?.currencies[0]?.code ?? "",
      creditLimit: customer?.creditLimit === undefined ? "" : String(customer.creditLimit),
    },
  });

  const save = async (values: CustomerValues) => {
    setServerError(null);
    const payload = {
      code: values.code,
      name: values.name,
      status: values.status,
      paymentTermsDays: Number(values.paymentTermsDays),
      taxGroupId: values.taxGroupId === "" ? null : (values.taxGroupId as Id<"taxGroups">),
      groupId: values.groupId === "" ? null : (values.groupId as Id<"customerGroups">),
      currency: values.currency,
      creditLimit: values.creditLimit.trim() === "" ? null : Number(values.creditLimit),
    };
    try {
      if (customer === null) {
        const id = await create(payload);
        toast.success("Customer created");
        onCreated?.(id);
      } else {
        await update({ customerId: customer._id, ...payload });
        toast.success("Customer saved");
      }
    } catch (err) {
      setServerError(toUserMessage(err));
    }
  };

  const currencies = options?.currencies ?? [];
  const groups = options?.taxGroups ?? [];
  const tiers = (options?.customerGroups ?? []).filter(
    (row) => row.active || row._id === customer?.groupId,
  );

  return (
    <Form methods={methods} onSubmit={(values) => void save(values)} className="space-y-4">
      {serverError ? <FormAlert title="Couldn't save the customer" message={serverError} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormInput name="code" label="Code" placeholder="ACME" isDisabled={!canSave} />
        <FormInput name="name" label="Company" placeholder="Acme Clinic" isDisabled={!canSave} />
        <FormSelect
          name="status"
          label="Account status"
          items={[
            { id: "active", label: "Active" },
            { id: "onHold", label: "On hold" },
            { id: "closed", label: "Closed" },
          ]}
          isDisabled={!canSave}
        />
        <FormInput
          name="paymentTermsDays"
          label="Payment terms (days)"
          hint="Zero means due on receipt."
          type="number"
          isDisabled={!canSave}
        />
        <FormSelect
          name="currency"
          label="Currency"
          placeholder="Choose a currency"
          items={currencies.map((row) => ({ id: row.code, label: `${row.code} · ${row.name}` }))}
          isDisabled={!canSave}
        />
        <FormSelect
          name="taxGroupId"
          label="Tax group"
          placeholder="No tax group"
          items={[
            { id: "", label: "No tax group" },
            ...groups.map((row) => ({ id: row._id, label: row.name })),
          ]}
          isDisabled={!canSave}
        />
        <FormSelect
          name="groupId"
          label="Customer group"
          placeholder="No group"
          hint="One tier per company."
          items={[
            { id: "", label: "No group" },
            ...tiers.map((row) => ({
              id: row._id,
              label: row.active ? row.name : `${row.name} (inactive)`,
            })),
          ]}
          isDisabled={!canSave}
        />
        <FormInput
          name="creditLimit"
          label="Credit limit"
          hint="Leave blank for no cap. Zero means nothing on account."
          type="number"
          isDisabled={!canSave}
        />
      </div>
      {canSave ? (
        <FormActions>
          <Button type="submit" color="primary" isLoading={methods.formState.isSubmitting}>
            {customer === null ? "Create customer" : "Save"}
          </Button>
        </FormActions>
      ) : null}
    </Form>
  );
}
