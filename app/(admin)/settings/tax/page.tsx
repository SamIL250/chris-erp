"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Dialog, DialogTrigger, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Card } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import {
  Form,
  FormActions,
  FormAlert,
  FormCheckbox,
  FormInput,
  FormSelect,
  useZodForm,
} from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useCan } from "@/hooks/use-can";
import { toUserMessage } from "@/lib/errors";
import { taxGroupSchema, taxRateSchema } from "@/lib/schemas/tax";

/**
 * Tax engine configuration (PH0-32): rates (basis points, inclusive flag)
 * and groups (one rate per product tax category). Customers receive a group
 * and products carry their category starting Phase 2 — `exempt` needs no
 * rate at all.
 */

type RateRow = Doc<"taxRates">;
type GroupRow = Doc<"taxGroups">;

const formatPercent = (bps: number) =>
  `${(bps / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;

function RateDialog({
  row,
  onOpenChange,
}: {
  row: RateRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useMutation(api.tax.createRate);
  const update = useMutation(api.tax.updateRate);
  const [serverError, setServerError] = useState<string | null>(null);
  const methods = useZodForm(taxRateSchema, {
    defaultValues: {
      name: row?.name ?? "",
      code: row?.code ?? "",
      percent: row ? String(row.rateBps / 100) : "0",
      inclusive: row?.inclusive ?? false,
      active: row?.active ?? true,
    },
  });

  return (
    <DialogTrigger isOpen onOpenChange={onOpenChange}>
      <ModalOverlay>
        <Modal className="sm:max-w-md">
          <Dialog className="flex max-h-[inherit] flex-col">
            <Form
              methods={methods}
              onSubmit={async (values) => {
                setServerError(null);
                const args = {
                  name: values.name,
                  code: values.code || undefined,
                  rateBps: Math.round(values.percent * 100),
                  inclusive: values.inclusive,
                  active: values.active,
                };
                try {
                  if (row) {
                    await update({ id: row._id, ...args });
                  } else {
                    await create(args);
                  }
                  toast.success(row ? "Tax rate updated" : "Tax rate added");
                  onOpenChange(false);
                } catch (error) {
                  setServerError(toUserMessage(error));
                }
              }}
            >
              <div className="space-y-5 p-6">
                <div>
                  <h2 className="text-display-xs text-primary font-semibold">
                    {row ? "Edit tax rate" : "Add tax rate"}
                  </h2>
                  <p className="text-secondary text-md mt-1.5">
                    Stored as exact basis points — 19.5% becomes 1950.
                  </p>
                </div>
                {serverError ? <FormAlert message={serverError} /> : null}
                <div className="grid gap-5 sm:grid-cols-2">
                  <FormInput name="name" label="Name" placeholder="VAT 20%" required />
                  <FormInput name="code" label="Short code" placeholder="VAT20" />
                  <FormInput
                    name="percent"
                    label="Rate (%)"
                    type="number"
                    placeholder="19.5"
                    required
                  />
                </div>
                <FormCheckbox
                  name="inclusive"
                  label="Inclusive — quoted prices already contain this tax"
                />
                <FormCheckbox name="active" label="Active — available for documents" />
                <FormActions>
                  <Button
                    type="submit"
                    color="primary"
                    size="lg"
                    isLoading={methods.formState.isSubmitting}
                  >
                    {row ? "Save changes" : "Add rate"}
                  </Button>
                </FormActions>
              </div>
            </Form>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}

function GroupDialog({
  row,
  rates,
  onOpenChange,
}: {
  row: GroupRow | null;
  rates: RateRow[];
  onOpenChange: (open: boolean) => void;
}) {
  const create = useMutation(api.tax.createGroup);
  const update = useMutation(api.tax.updateGroup);
  const [serverError, setServerError] = useState<string | null>(null);
  const methods = useZodForm(taxGroupSchema, {
    defaultValues: {
      name: row?.name ?? "",
      isDefault: row?.isDefault ?? false,
      standard: row?.rates.standard ?? "",
      reduced: row?.rates.reduced ?? "",
      zero: row?.rates.zero ?? "",
      active: row?.active ?? true,
    },
  });
  const rateItems = [
    { id: "", label: "No rate" },
    ...rates.map((rate) => ({
      id: rate._id as string,
      label: `${rate.name} (${formatPercent(rate.rateBps)})`,
    })),
  ];

  return (
    <DialogTrigger isOpen onOpenChange={onOpenChange}>
      <ModalOverlay>
        <Modal className="sm:max-w-md">
          <Dialog className="flex max-h-[inherit] flex-col">
            <Form
              methods={methods}
              onSubmit={async (values) => {
                setServerError(null);
                const args = {
                  name: values.name,
                  isDefault: values.isDefault,
                  active: values.active,
                  // Select stores strings; "" means no rate for that slot.
                  rates: {
                    standard: (values.standard || undefined) as Id<"taxRates"> | undefined,
                    reduced: (values.reduced || undefined) as Id<"taxRates"> | undefined,
                    zero: (values.zero || undefined) as Id<"taxRates"> | undefined,
                  },
                };
                try {
                  if (row) {
                    await update({ id: row._id, ...args });
                  } else {
                    await create(args);
                  }
                  toast.success(row ? "Tax group updated" : "Tax group added");
                  onOpenChange(false);
                } catch (error) {
                  setServerError(toUserMessage(error));
                }
              }}
            >
              <div className="space-y-5 p-6">
                <div>
                  <h2 className="text-display-xs text-primary font-semibold">
                    {row ? "Edit tax group" : "Add tax group"}
                  </h2>
                  <p className="text-secondary text-md mt-1.5">
                    Maps each product tax category to a rate. Customers get assigned a group in
                    Phase 2.
                  </p>
                </div>
                {serverError ? <FormAlert message={serverError} /> : null}
                <FormInput name="name" label="Name" placeholder="UK VAT" required />
                <div className="grid gap-5 sm:grid-cols-3">
                  <FormSelect name="standard" label="Standard" items={rateItems} />
                  <FormSelect name="reduced" label="Reduced" items={rateItems} />
                  <FormSelect name="zero" label="Zero" items={rateItems} />
                </div>
                <FormCheckbox name="isDefault" label="Default group — assigned to new customers" />
                <FormCheckbox name="active" label="Active — available for customers" />
                <FormActions>
                  <Button
                    type="submit"
                    color="primary"
                    size="lg"
                    isLoading={methods.formState.isSubmitting}
                  >
                    {row ? "Save changes" : "Add group"}
                  </Button>
                </FormActions>
              </div>
            </Form>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}

export default function TaxSettingsPage() {
  const rates = useQuery(api.tax.rates);
  const groups = useQuery(api.tax.groups);
  const canCreate = useCan("settings", "create");
  const canEdit = useCan("settings", "edit");
  const [rateDialog, setRateDialog] = useState<RateRow | "new" | null>(null);
  const [groupDialog, setGroupDialog] = useState<GroupRow | "new" | null>(null);

  if (rates === undefined || groups === undefined) {
    return (
      <div className="flex max-w-4xl flex-col gap-6">
        <PageHeader title="Tax" description="Rates and groups." />
        <Skeleton className="h-96" />
      </div>
    );
  }

  const rateById = new Map(rates.map((rate) => [rate._id, rate]));
  const rateName = (id: Id<"taxRates"> | undefined) =>
    id === undefined ? "—" : (rateById.get(id)?.name ?? "—");

  const rateColumns: DataTableColumn<RateRow>[] = [
    {
      id: "name",
      header: "Rate",
      cell: (row) => (
        <div>
          <span className="text-primary block text-sm font-medium">{row.name}</span>
          {row.code ? <span className="text-tertiary font-mono text-xs">{row.code}</span> : null}
        </div>
      ),
    },
    {
      id: "percent",
      header: "Rate",
      cell: (row) => (
        <span className="text-primary font-mono text-sm">{formatPercent(row.rateBps)}</span>
      ),
    },
    {
      id: "basis",
      header: "Basis",
      cell: (row) => (
        <Badge color={row.inclusive ? "brand" : "gray"} size="sm">
          {row.inclusive ? "Inclusive" : "Exclusive"}
        </Badge>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <Badge color={row.active ? "success" : "gray"} size="sm">
          {row.active ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    ...(canEdit
      ? [
          {
            id: "edit",
            header: "",
            cell: (row: RateRow) => (
              <Button color="secondary" size="sm" onPress={() => setRateDialog(row)}>
                Edit
              </Button>
            ),
          } satisfies DataTableColumn<RateRow>,
        ]
      : []),
  ];

  const groupColumns: DataTableColumn<GroupRow>[] = [
    {
      id: "name",
      header: "Group",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <span className="text-primary text-sm font-medium">{row.name}</span>
          {row.isDefault ? (
            <Badge color="brand" size="sm">
              Default
            </Badge>
          ) : null}
        </div>
      ),
    },
    {
      id: "standard",
      header: "Standard",
      cell: (row) => <span className="text-sm">{rateName(row.rates.standard)}</span>,
    },
    {
      id: "reduced",
      header: "Reduced",
      cell: (row) => <span className="text-sm">{rateName(row.rates.reduced)}</span>,
    },
    {
      id: "zero",
      header: "Zero",
      cell: (row) => <span className="text-sm">{rateName(row.rates.zero)}</span>,
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <Badge color={row.active ? "success" : "gray"} size="sm">
          {row.active ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    ...(canEdit
      ? [
          {
            id: "edit",
            header: "",
            cell: (row: GroupRow) => (
              <Button color="secondary" size="sm" onPress={() => setGroupDialog(row)}>
                Edit
              </Button>
            ),
          } satisfies DataTableColumn<GroupRow>,
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tax"
        description="Tax rates and the groups that map product categories to them — pricing and documents resolve through these in Phase 2."
      />

      <DataTable
        title="Tax rates"
        columns={rateColumns}
        rows={rates}
        rowId={(row) => row._id}
        toolbar={
          canCreate ? (
            <Button color="primary" size="sm" onPress={() => setRateDialog("new")}>
              Add rate
            </Button>
          ) : null
        }
        empty={{
          title: "No tax rates yet",
          description: canCreate
            ? "Add the rates you charge — e.g. standard VAT, reduced rate, zero rate."
            : "An administrator can add tax rates from this page.",
        }}
      />

      <DataTable
        title="Tax groups"
        columns={groupColumns}
        rows={groups}
        rowId={(row) => row._id}
        toolbar={
          canCreate ? (
            <Button color="primary" size="sm" onPress={() => setGroupDialog("new")}>
              Add group
            </Button>
          ) : null
        }
        empty={{
          title: "No tax groups yet",
          description: canCreate
            ? "Group your rates into the schemes you sell under (standard/reduced/zero)."
            : "An administrator can add tax groups from this page.",
        }}
      />

      <Card>
        <div className="space-y-3 p-6">
          <h2 className="text-primary text-md font-semibold">Product tax categories</h2>
          <ul className="text-secondary space-y-1.5 text-sm">
            <li>
              <span className="text-primary font-medium">Standard / Reduced / Zero</span> — every
              tax group maps these three categories to one of its rates; the group decides which
              applies.
            </li>
            <li>
              <span className="text-primary font-medium">Exempt</span> — a product-level category
              that carries no rate at all (set per product when the catalog arrives in Phase 2).
            </li>
            <li>
              <span className="text-primary font-medium">Assignment</span> — customers get a group
              and products get a category in Phase 2; this page is the configuration they resolve
              against.
            </li>
          </ul>
        </div>
      </Card>

      {rateDialog !== null ? (
        <RateDialog
          row={rateDialog === "new" ? null : rateDialog}
          onOpenChange={(open) => !open && setRateDialog(null)}
        />
      ) : null}
      {groupDialog !== null ? (
        <GroupDialog
          row={groupDialog === "new" ? null : groupDialog}
          rates={rates}
          onOpenChange={(open) => !open && setGroupDialog(null)}
        />
      ) : null}
    </div>
  );
}
