"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Dialog, DialogTrigger, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { Button } from "@/components/base/buttons/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import {
  Form,
  FormActions,
  FormAlert,
  FormInput,
  FormSelect,
  useZodForm,
} from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { formatSequence } from "@/convex/_lib/sequences";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { useCan } from "@/hooks/use-can";
import { toUserMessage } from "@/lib/errors";
import { sequenceSchema } from "@/lib/schemas/sequences";

/**
 * Document numbering (PH0-30): every sequence with its next-to-be-issued
 * number, editable prefix/padding behind a dialog with a live preview from
 * the same `formatSequence` that issuance uses. The counter itself (`next`)
 * is never edited here — it only grows.
 */

type SequenceRow = Doc<"sequences">;

const DOCUMENT_LABELS: Record<string, string> = {
  quote: "Quote",
  salesOrder: "Sales order",
  deliveryNote: "Delivery note",
  invoice: "Invoice",
  creditNote: "Credit note",
  purchaseOrder: "Purchase order",
  goodsReceipt: "Goods receipt",
  payment: "Payment",
  journal: "Journal entry",
  rma: "RMA",
  workOrder: "Work order",
};

const labelFor = (row: SequenceRow) => DOCUMENT_LABELS[row.name] ?? row.name;

const PADDING_ITEMS = ["1", "2", "3", "4", "5", "6"].map((digit) => ({
  id: digit,
  label: `${digit} digit${digit === "1" ? "" : "s"}`,
}));

function EditForm({ row, onSaved }: { row: SequenceRow; onSaved: () => void }) {
  const update = useMutation(api.sequences.update);
  const [serverError, setServerError] = useState<string | null>(null);
  const methods = useZodForm(sequenceSchema, {
    defaultValues: { prefix: row.prefix, padding: String(row.padding) },
  });

  const prefix = methods.watch("prefix");
  const padding = methods.watch("padding");
  const preview = formatSequence({
    prefix: prefix?.trim().toUpperCase() || row.prefix,
    next: row.next,
    padding:
      Number.isInteger(Number(padding)) && Number(padding) >= 1 ? Number(padding) : row.padding,
  });

  return (
    <Form
      methods={methods}
      onSubmit={async (values) => {
        setServerError(null);
        try {
          await update({ id: row._id, prefix: values.prefix, padding: values.padding });
          toast.success("Document numbering updated");
          onSaved();
        } catch (error) {
          setServerError(toUserMessage(error));
        }
      }}
    >
      <div className="space-y-5 p-6">
        <div>
          <h2 className="text-display-xs text-primary font-semibold">{labelFor(row)}</h2>
          <p className="text-secondary text-md mt-1.5">
            This sequence issues document numbers in order — currently at{" "}
            <span className="text-primary font-medium">{formatSequence(row)}</span>.
          </p>
        </div>

        <div className="bg-secondary rounded-xl p-4 text-center">
          <p className="text-tertiary text-xs font-medium">NEXT NUMBER WILL READ</p>
          <p className="text-primary mt-1 font-mono text-lg font-semibold">{preview}</p>
        </div>

        {serverError ? <FormAlert message={serverError} /> : null}

        <div className="grid gap-5 sm:grid-cols-2">
          <FormInput
            name="prefix"
            label="Prefix"
            hint="Letters, numbers, dashes — add a trailing dash if you want one (INV-)."
          />
          <FormSelect name="padding" label="Padding" items={PADDING_ITEMS} />
        </div>

        <FormActions>
          <Button
            type="submit"
            color="primary"
            size="lg"
            isLoading={methods.formState.isSubmitting}
          >
            Save
          </Button>
        </FormActions>
      </div>
    </Form>
  );
}

export default function DocumentNumberingPage() {
  const sequences = useQuery(api.sequences.list);
  const ensureDefaults = useMutation(api.sequences.ensureDefaults);
  const canCreate = useCan("settings", "create");
  const canEdit = useCan("settings", "edit");
  const [editing, setEditing] = useState<SequenceRow | null>(null);

  const initialize = async () => {
    try {
      await ensureDefaults();
      toast.success("Document numbering initialized");
    } catch (error) {
      toast.error(toUserMessage(error));
    }
  };

  const columns: DataTableColumn<SequenceRow>[] = [
    {
      id: "document",
      header: "Document",
      cell: (row) => (
        <div>
          <span className="text-primary block text-sm font-medium">{labelFor(row)}</span>
          <span className="text-tertiary font-mono text-xs">{row.name}</span>
        </div>
      ),
    },
    {
      id: "next",
      header: "Next number",
      cell: (row) => <span className="text-primary font-mono text-sm">{formatSequence(row)}</span>,
    },
    {
      id: "prefix",
      header: "Prefix",
      cell: (row) => <span className="font-mono text-sm">{row.prefix}</span>,
    },
    {
      id: "padding",
      header: "Padding",
      cell: (row) => <span className="text-secondary text-sm">{row.padding} digits</span>,
    },
    ...(canEdit
      ? [
          {
            id: "edit",
            header: "",
            cell: (row: SequenceRow) => (
              <Button color="secondary" size="sm" onPress={() => setEditing(row)}>
                Edit
              </Button>
            ),
          } satisfies DataTableColumn<SequenceRow>,
        ]
      : []),
  ];

  const initializeButton = canCreate ? (
    <Button color="primary" size="sm" onPress={() => void initialize()}>
      Initialize default numbering
    </Button>
  ) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Document numbering"
        description="Prefixes and zero-padding for the numbers every document gets (INV-0042). The counter advances as documents are issued — it can't be edited here."
      />

      {sequences === undefined ? (
        <Skeleton className="h-96" />
      ) : (
        <DataTable
          title="Sequences"
          columns={columns}
          rows={sequences}
          rowId={(row) => row._id}
          empty={{
            title: "Numbering not initialized yet",
            description: canCreate
              ? "Create the standard document sequences (quotes, invoices, orders, …) to get started."
              : "An administrator can initialize document numbering from this page.",
            action: initializeButton ?? undefined,
          }}
        />
      )}

      <DialogTrigger isOpen={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <ModalOverlay>
          <Modal className="sm:max-w-md">
            <Dialog className="flex max-h-[inherit] flex-col">
              {editing ? (
                <EditForm key={editing._id} row={editing} onSaved={() => setEditing(null)} />
              ) : null}
            </Dialog>
          </Modal>
        </ModalOverlay>
      </DialogTrigger>
    </div>
  );
}
