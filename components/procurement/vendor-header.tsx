"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import {
  Form,
  FormActions,
  FormAlert,
  FormCheckbox,
  FormInput,
  FormSelect,
  useZodForm,
} from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { toUserMessage } from "@/lib/errors";
import { vendorSchema, type VendorValues } from "@/lib/schemas/vendors";
import { licenseExpiryFromInput, licenseExpiryInput } from "@/lib/vendors";

type Options = {
  currencies: { code: string; name: string }[];
  taxGroups: { _id: Id<"taxGroups">; name: string }[];
  baseCurrency: string | null;
};

/**
 * Company fields for a vendor (PH2-03). Create returns the new id.
 * Save on an existing vendor updates that row. License expiry is stored
 * even when the date is already past.
 */
export function VendorHeader({
  vendor,
  options,
  canSave,
  onCreated,
}: {
  vendor: Doc<"vendors"> | null;
  options: Options | undefined;
  canSave: boolean;
  onCreated?: (id: Id<"vendors">) => void;
}) {
  const create = useMutation(api.procurement.vendors.create);
  const update = useMutation(api.procurement.vendors.update);
  const [serverError, setServerError] = useState<string | null>(null);
  const methods = useZodForm(vendorSchema, {
    defaultValues: {
      code: vendor?.code ?? "",
      name: vendor?.name ?? "",
      active: vendor?.active ?? true,
      paymentTermsDays: vendor ? String(vendor.paymentTermsDays) : "0",
      taxGroupId: vendor?.taxGroupId ?? "",
      taxNumber: vendor?.taxNumber ?? "",
      currency: vendor?.currency ?? options?.baseCurrency ?? options?.currencies[0]?.code ?? "",
      licenseNumber: vendor?.licenseNumber ?? "",
      licenseJurisdiction: vendor?.licenseJurisdiction ?? "",
      licenseExpiresOn:
        vendor?.licenseExpiresOn === undefined ? "" : licenseExpiryInput(vendor.licenseExpiresOn),
    },
  });

  const save = async (values: VendorValues) => {
    setServerError(null);
    const expiry = licenseExpiryFromInput(values.licenseExpiresOn);
    if ("error" in expiry) {
      setServerError(expiry.error);
      return;
    }
    const payload = {
      code: values.code,
      name: values.name,
      active: values.active,
      paymentTermsDays: Number(values.paymentTermsDays),
      taxGroupId: values.taxGroupId === "" ? null : (values.taxGroupId as Id<"taxGroups">),
      taxNumber: values.taxNumber.trim() === "" ? null : values.taxNumber,
      currency: values.currency,
      licenseNumber: values.licenseNumber.trim() === "" ? null : values.licenseNumber,
      licenseJurisdiction:
        values.licenseJurisdiction.trim() === "" ? null : values.licenseJurisdiction,
      licenseExpiresOn: expiry.ms,
    };
    try {
      if (vendor === null) {
        const id = await create(payload);
        toast.success("Vendor created");
        onCreated?.(id);
      } else {
        await update({ vendorId: vendor._id, ...payload });
        toast.success("Vendor saved");
      }
    } catch (err) {
      setServerError(toUserMessage(err));
    }
  };

  const currencies = options?.currencies ?? [];
  const groups = options?.taxGroups ?? [];

  return (
    <Form methods={methods} onSubmit={(values) => void save(values)} className="space-y-4">
      {serverError ? <FormAlert title="Couldn't save the vendor" message={serverError} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormInput name="code" label="Code" placeholder="MEDSUP" isDisabled={!canSave} />
        <FormInput name="name" label="Company" placeholder="Med Supply" isDisabled={!canSave} />
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
        <FormInput
          name="taxNumber"
          label="Tax number"
          placeholder="GB123456789"
          isDisabled={!canSave}
        />
        <FormInput
          name="licenseNumber"
          label="License number"
          hint="Stored now. An expired license is not blocked until Phase 5."
          isDisabled={!canSave}
        />
        <FormInput name="licenseJurisdiction" label="Jurisdiction" isDisabled={!canSave} />
        <FormInput
          name="licenseExpiresOn"
          label="License expiry"
          type="date"
          isDisabled={!canSave}
        />
        <FormCheckbox
          name="active"
          label="Active"
          hint="An inactive vendor stays on file. Purchasing will refuse them later."
          isDisabled={!canSave}
        />
      </div>
      {canSave ? (
        <FormActions>
          <Button type="submit" color="primary" isLoading={methods.formState.isSubmitting}>
            {vendor === null ? "Create vendor" : "Save"}
          </Button>
        </FormActions>
      ) : null}
    </Form>
  );
}
