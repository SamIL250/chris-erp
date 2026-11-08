"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import {
  Form,
  FormActions,
  FormAlert,
  FormCheckbox,
  FormInput,
  FormTextarea,
  useZodForm,
} from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useCan } from "@/hooks/use-can";
import { toUserMessage } from "@/lib/errors";
import { warehouseSchema, type WarehouseValues } from "@/lib/schemas/warehouses";

/**
 * Warehouses (PH1-16): the locations stock will be counted against.
 * One row is the default. Deactivating or removing that row is refused
 * until another warehouse takes the flag — the server is the authority.
 */

type WarehouseRow = Doc<"warehouses">;
type Editor = { mode: "create" } | { mode: "edit"; row: WarehouseRow };

const EMPTY: WarehouseValues = {
  code: "",
  name: "",
  address: "",
  isDefault: false,
  active: true,
};

function WarehouseForm({
  editor,
  onSaved,
  onClose,
}: {
  editor: Editor;
  onSaved: () => void;
  onClose: () => void;
}) {
  const create = useMutation(api.inventory.warehouses.create);
  const update = useMutation(api.inventory.warehouses.update);
  const remove = useMutation(api.inventory.warehouses.remove);
  const canDelete = useCan("inventory", "delete");
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const editing = editor.mode === "edit" ? editor.row : null;
  const methods = useZodForm(warehouseSchema, {
    defaultValues: editing
      ? {
          code: editing.code,
          name: editing.name,
          address: editing.address ?? "",
          isDefault: editing.isDefault,
          active: editing.active,
        }
      : EMPTY,
  });

  const save = async (values: WarehouseValues) => {
    setServerError(null);
    const payload = {
      code: values.code,
      name: values.name,
      address: values.address,
      isDefault: values.isDefault,
      active: values.active,
    };
    try {
      if (editing) {
        await update({ id: editing._id, ...payload });
        toast.success("Warehouse updated");
      } else {
        await create(payload);
        toast.success("Warehouse created");
      }
      onSaved();
    } catch (error) {
      setServerError(toUserMessage(error));
    }
  };

  const destroy = async (id: Id<"warehouses">) => {
    setServerError(null);
    try {
      await remove({ id });
      toast.success("Warehouse removed");
      onSaved();
    } catch (error) {
      setServerError(toUserMessage(error));
    }
  };

  return (
    <Form methods={methods} onSubmit={save}>
      <div className="space-y-5 p-6">
        <div>
          <h2 className="text-display-xs text-primary font-semibold">
            {editing ? editing.name : "New warehouse"}
          </h2>
          <p className="text-secondary text-md mt-1.5">
            A short code staff can type, and the address goods ship from. One warehouse is the
            default for receipts that don't name one.
          </p>
        </div>
        {serverError ? <FormAlert message={serverError} /> : null}
        <FormInput name="code" label="Code" placeholder="MAIN" required />
        <FormInput name="name" label="Name" placeholder="Main warehouse" required />
        <FormTextarea
          name="address"
          label="Address"
          placeholder="Street, city, region"
          rows={3}
          hint="Optional. Shown on documents that ship from this warehouse."
        />
        <FormCheckbox
          name="isDefault"
          label="Default warehouse"
          hint={
            editing?.isDefault
              ? "To move the default, open the warehouse that should take it."
              : "Receipts without a warehouse land here."
          }
        />
        <FormCheckbox
          name="active"
          label="Active"
          hint="Inactive warehouses stay on file for history."
        />
        <FormActions className="justify-between">
          {editing && canDelete ? (
            <Button
              type="button"
              color="tertiary-destructive"
              onPress={() => {
                if (!confirmRemove) {
                  setConfirmRemove(true);
                  return;
                }
                void destroy(editing._id);
              }}
            >
              {confirmRemove ? "Confirm remove" : "Remove"}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3">
            <Button type="button" color="secondary" onPress={onClose}>
              Cancel
            </Button>
            <Button type="submit" color="primary" isLoading={methods.formState.isSubmitting}>
              {editing ? "Save" : "Create warehouse"}
            </Button>
          </div>
        </FormActions>
      </div>
    </Form>
  );
}

export default function WarehousesPage() {
  const rows = useQuery(api.inventory.warehouses.list);
  const canCreate = useCan("inventory", "create");
  const canEdit = useCan("inventory", "edit");
  const [editor, setEditor] = useState<Editor | null>(null);

  const columns: DataTableColumn<WarehouseRow>[] = [
    {
      id: "code",
      header: "Code",
      cell: (row) => <span className="text-primary font-mono text-sm font-medium">{row.code}</span>,
    },
    {
      id: "name",
      header: "Name",
      cell: (row) => (
        <div className="min-w-0">
          <span className="text-primary block truncate text-sm font-medium">{row.name}</span>
          {row.address ? (
            <span className="text-tertiary block truncate text-xs">{row.address}</span>
          ) : null}
        </div>
      ),
    },
    {
      id: "default",
      header: "Default",
      cell: (row) =>
        row.isDefault ? (
          <Badge color="brand" size="sm">
            Default
          </Badge>
        ) : (
          <span className="text-tertiary text-sm">—</span>
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
    {
      id: "actions",
      header: "",
      cell: (row) =>
        canEdit ? (
          <Button size="sm" color="secondary" onPress={() => setEditor({ mode: "edit", row })}>
            Edit
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Warehouses"
        description="Places stock is stored. One of them is the default — receipts that don't name a warehouse land there."
        actions={
          canCreate ? (
            <Button color="primary" onPress={() => setEditor({ mode: "create" })}>
              New warehouse
            </Button>
          ) : null
        }
      />

      {rows === undefined ? (
        <Skeleton className="h-96" />
      ) : (
        <DataTable
          title="Warehouses"
          columns={columns}
          rows={rows}
          rowId={(row) => row._id}
          empty={{
            title: "No warehouses yet",
            description: canCreate
              ? "Add the first location. It becomes the default."
              : "Someone with inventory access can add the first warehouse.",
            action: canCreate ? (
              <Button color="primary" size="sm" onPress={() => setEditor({ mode: "create" })}>
                New warehouse
              </Button>
            ) : undefined,
          }}
        />
      )}

      <ModalOverlay
        isDismissable
        isOpen={editor !== null}
        onOpenChange={(open) => !open && setEditor(null)}
      >
        <Modal className="sm:max-w-md">
          <Dialog className="flex max-h-[inherit] flex-col">
            {editor ? (
              <WarehouseForm
                key={editor.mode === "edit" ? editor.row._id : "new"}
                editor={editor}
                onSaved={() => setEditor(null)}
                onClose={() => setEditor(null)}
              />
            ) : null}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </div>
  );
}
