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
  useZodForm,
} from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toUserMessage } from "@/lib/errors";
import { customerGroupSchema, type CustomerGroupValues } from "@/lib/schemas/customer-groups";

type Group = { _id: Id<"customerGroups">; name: string; active: boolean };

/**
 * Name and active flag for a customer group (PH2-02). Create and edit
 * share this form. A group is never deleted.
 */
export function CustomerGroupForm({
  group,
  canSave,
  onSaved,
  onCancel,
}: {
  group: Group | null;
  canSave: boolean;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const create = useMutation(api.sales.customerGroups.create);
  const update = useMutation(api.sales.customerGroups.update);
  const [serverError, setServerError] = useState<string | null>(null);
  const methods = useZodForm(customerGroupSchema, {
    defaultValues: {
      name: group?.name ?? "",
      active: group?.active ?? true,
    },
  });

  const save = async (values: CustomerGroupValues) => {
    setServerError(null);
    try {
      if (group === null) {
        await create({ name: values.name, active: values.active });
        toast.success("Customer group created");
      } else {
        await update({ groupId: group._id, name: values.name, active: values.active });
        toast.success("Customer group saved");
      }
      onSaved();
    } catch (err) {
      setServerError(toUserMessage(err));
    }
  };

  return (
    <Form methods={methods} onSubmit={(values) => void save(values)}>
      <div className="space-y-5 p-6">
        <div>
          <h2 className="text-display-xs text-primary font-semibold">
            {group === null ? "New customer group" : group.name}
          </h2>
          <p className="text-secondary text-md mt-1.5">
            A tier a company buys at. One company belongs to one group.
          </p>
        </div>
        {serverError ? (
          <FormAlert title="Couldn't save the customer group" message={serverError} />
        ) : null}
        <FormInput name="name" label="Name" placeholder="Wholesale" isDisabled={!canSave} />
        <FormCheckbox
          name="active"
          label="Active"
          hint="An inactive tier stays on the companies that already use it. It can't be chosen for anyone new."
          isDisabled={!canSave}
        />
        {canSave ? (
          <FormActions className="justify-end">
            {onCancel ? (
              <Button type="button" color="secondary" onPress={onCancel}>
                Cancel
              </Button>
            ) : null}
            <Button type="submit" color="primary" isLoading={methods.formState.isSubmitting}>
              {group === null ? "Create group" : "Save"}
            </Button>
          </FormActions>
        ) : null}
      </div>
    </Form>
  );
}
