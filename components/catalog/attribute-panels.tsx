"use client";

import { useMutation } from "convex/react";
import { useState, type ReactNode } from "react";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Card } from "@/components/ui/card";
import {
  Form,
  FormAlert,
  FormInput,
  FormSelect,
  FormTextarea,
  useZodForm,
} from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { toUserMessage } from "@/lib/errors";
import {
  ATTRIBUTE_TYPES,
  ATTRIBUTE_TYPE_LABELS,
  attributeSetSchema,
  definitionSchema,
  isSelectType,
  parseOptions,
  type DefinitionFormValues,
  type AttributeSetFormValues,
} from "@/lib/schemas/attributes";
import { cx } from "@/utils/cx";

/**
 * Side-panel editors for the Attributes page (PH1-04): one panel per
 * entity — a definition (name/type/unit/options) and a set (name +
 * attribute checkboxes + category checkboxes). Mirrors the category side
 * editor: create/edit/delete in place, two-step delete confirm, view-only
 * roles get a read-only facts panel instead of the form (the server
 * refuses their writes regardless — docs/permissions.md rule 1).
 *
 * The form only SENDS what the type allows (unit → number, options →
 * select family); the server re-validates and its ConvexErrors surface
 * through `toUserMessage` in the form alert or a toast.
 */

type DefinitionRow = Doc<"attributeDefinitions">;
type AttributeSetRow = Doc<"attributeSets">;
type CategoryRow = Doc<"categories"> & { depth: number; path: Id<"categories">[] };

/** Shared chrome for the side panel: card + heading + close. */
function PanelShell({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Card>
      <div className="border-tertiary flex items-start justify-between gap-4 border-b px-6 py-4">
        <div className="min-w-0">
          <h2 className="text-primary text-md truncate font-semibold">{title}</h2>
          {description ? <p className="text-secondary mt-0.5 text-sm">{description}</p> : null}
        </div>
        <Button color="tertiary" size="sm" onPress={onClose}>
          Close
        </Button>
      </div>
      {children}
    </Card>
  );
}

/** label → value rows for the view-only variant of each editor. */
function FactList({ facts }: { facts: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="space-y-3 p-6">
      {facts.map((fact) => (
        <div key={fact.label} className="flex items-start justify-between gap-4">
          <dt className="text-tertiary shrink-0 text-sm">{fact.label}</dt>
          <dd className="text-primary min-w-0 text-right text-sm break-words">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Save/Cancel footer with the gated two-step delete on the left. */
function PanelFooter({
  showDelete,
  confirmDelete,
  onDelete,
  onArmDelete,
  isSaving,
  onClose,
}: {
  showDelete: boolean;
  confirmDelete: boolean;
  onDelete: () => void;
  onArmDelete: () => void;
  isSaving: boolean;
  onClose: () => void;
}) {
  return (
    <div className="border-tertiary flex items-center justify-between gap-3 border-t px-6 py-4">
      <div>
        {showDelete ? (
          confirmDelete ? (
            <Button color="tertiary" className="text-error" onPress={onDelete}>
              Confirm delete
            </Button>
          ) : (
            <Button color="tertiary" className="text-error" onPress={onArmDelete}>
              Delete
            </Button>
          )
        ) : null}
      </div>
      <div className="flex gap-3">
        <Button color="secondary" onPress={onClose}>
          Cancel
        </Button>
        <Button type="submit" color="primary" isLoading={isSaving}>
          Save
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- definition */

export function DefinitionPanel({
  mode,
  definition,
  canEdit,
  canDelete,
  onClose,
  onCreated,
}: {
  mode: "create" | "edit";
  definition: DefinitionRow | null;
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
  onCreated: (id: Id<"attributeDefinitions">) => void;
}) {
  const create = useMutation(api.catalog.attributes.create);
  const update = useMutation(api.catalog.attributes.update);
  const remove = useMutation(api.catalog.attributes.remove);
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isCreate = mode === "create";
  const methods = useZodForm(definitionSchema, {
    defaultValues: {
      name: definition?.name ?? "",
      type: definition?.type ?? "text",
      unit: definition?.unit ?? "",
      optionsText: definition?.options.join("\n") ?? "",
    },
  });
  const typeValue = methods.watch("type");
  const showUnit = typeValue === "number";
  const showOptions = isSelectType(typeValue);

  // Deleted while open: say so instead of rendering an empty form.
  if (!isCreate && definition === null) {
    return (
      <PanelShell title="Attribute not found" onClose={onClose}>
        <p className="text-secondary p-6 text-sm">
          It was deleted — pick another one from the list.
        </p>
      </PanelShell>
    );
  }

  // View-only roles get facts, not a form (the server would refuse anyway).
  if (definition !== null && !canEdit) {
    return (
      <PanelShell title={definition.name} description="View only." onClose={onClose}>
        <FactList
          facts={[
            { label: "Type", value: ATTRIBUTE_TYPE_LABELS[definition.type] },
            ...(definition.unit ? [{ label: "Unit", value: definition.unit }] : []),
            {
              label: "Options",
              value:
                definition.options.length > 0 ? (
                  <span className="font-mono text-xs">{definition.options.join(" · ")}</span>
                ) : (
                  "—"
                ),
            },
          ]}
        />
      </PanelShell>
    );
  }

  const handleDelete = async () => {
    if (definition === null) return;
    try {
      await remove({ id: definition._id });
      toast.success("Attribute deleted");
      onClose();
    } catch (error) {
      toast.error(toUserMessage(error));
      setConfirmDelete(false);
    }
  };

  const submit = async (values: DefinitionFormValues) => {
    setServerError(null);
    const isSelect = isSelectType(values.type);
    const options = parseOptions(values.optionsText);
    if (isSelect && options.length === 0) {
      setServerError("Select and Multi-select attributes need at least one option.");
      return;
    }
    // Only send what the type allows — mirrors the server's shape rules.
    const typed = {
      name: values.name,
      type: values.type,
      ...(values.type === "number" && values.unit.trim() !== "" ? { unit: values.unit } : {}),
      ...(isSelect ? { options } : {}),
    };
    try {
      if (isCreate) {
        const { id } = await create(typed);
        toast.success("Attribute created");
        onCreated(id);
        return;
      }
      if (definition === null) return; // unreachable: handled above
      await update({ id: definition._id, ...typed });
      toast.success("Attribute saved");
    } catch (error) {
      setServerError(toUserMessage(error));
      setConfirmDelete(false);
    }
  };

  return (
    <PanelShell
      title={isCreate ? "New attribute" : (definition?.name ?? "Attribute")}
      description={
        isCreate
          ? "The spec fields products carry — group them into a set next."
          : "Changing the type keeps existing values honest — review products after."
      }
      onClose={onClose}
    >
      <Form methods={methods} onSubmit={submit}>
        <div className="space-y-5 p-6">
          {serverError ? <FormAlert message={serverError} /> : null}
          <FormInput name="name" label="Name" placeholder="Weight" required />
          <FormSelect
            name="type"
            label="Type"
            items={ATTRIBUTE_TYPES.map((type) => ({
              id: type,
              label: ATTRIBUTE_TYPE_LABELS[type],
            }))}
            hint="Determines the input products get and where values can be used."
          />
          {showUnit ? (
            <FormInput name="unit" label="Unit" placeholder="kg" hint="Shown next to the value." />
          ) : null}
          {showOptions ? (
            <FormTextarea
              name="optionsText"
              label="Options"
              rows={6}
              placeholder={"Black\nSilver"}
              hint="One option per line — shown in this order in the picker."
            />
          ) : null}
        </div>
        <PanelFooter
          showDelete={!isCreate && canDelete}
          confirmDelete={confirmDelete}
          onDelete={handleDelete}
          onArmDelete={() => setConfirmDelete(true)}
          isSaving={methods.formState.isSubmitting}
          onClose={onClose}
        />
      </Form>
    </PanelShell>
  );
}

/* -------------------------------------------------------------------- set */

export function SetPanel({
  mode,
  set,
  definitions,
  categories,
  canEdit,
  canDelete,
  onClose,
  onCreated,
}: {
  mode: "create" | "edit";
  set: AttributeSetRow | null;
  definitions: DefinitionRow[];
  categories: CategoryRow[];
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
  onCreated: (id: Id<"attributeSets">) => void;
}) {
  const create = useMutation(api.catalog.attributeSets.create);
  const update = useMutation(api.catalog.attributeSets.update);
  const remove = useMutation(api.catalog.attributeSets.remove);
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [attributeIds, setAttributeIds] = useState<string[]>(set?.attributeIds ?? []);
  const [categoryIds, setCategoryIds] = useState<string[]>(set?.categoryIds ?? []);

  const isCreate = mode === "create";
  const methods = useZodForm(attributeSetSchema, {
    defaultValues: { name: set?.name ?? "" },
  });

  if (!isCreate && set === null) {
    return (
      <PanelShell title="Attribute set not found" onClose={onClose}>
        <p className="text-secondary p-6 text-sm">It was deleted — pick another one.</p>
      </PanelShell>
    );
  }

  if (set !== null && !canEdit) {
    const definitionName = (id: string) => definitions.find((row) => row._id === id)?.name ?? "—";
    const categoryName = (id: string) => categories.find((row) => row._id === id)?.name ?? "—";
    return (
      <PanelShell title={set.name} description="View only." onClose={onClose}>
        <FactList
          facts={[
            {
              label: "Attributes",
              value:
                set.attributeIds.length > 0
                  ? set.attributeIds.map(definitionName).join(" · ")
                  : "None",
            },
            {
              label: "Categories",
              value:
                set.categoryIds.length > 0
                  ? set.categoryIds.map(categoryName).join(" · ")
                  : "None — applies nowhere yet",
            },
          ]}
        />
      </PanelShell>
    );
  }

  const toggle =
    (list: string[], setList: (next: string[]) => void) => (id: string, selected: boolean) => {
      setList(selected ? [...list, id] : list.filter((existing) => existing !== id));
    };
  const toggleAttribute = (id: string, selected: boolean) =>
    toggle(attributeIds, (next) => setAttributeIds(next))(id, selected);
  const toggleCategory = (id: string, selected: boolean) =>
    toggle(categoryIds, (next) => setCategoryIds(next))(id, selected);

  const handleDelete = async () => {
    if (set === null) return;
    try {
      await remove({ id: set._id });
      toast.success("Attribute set deleted");
      onClose();
    } catch (error) {
      toast.error(toUserMessage(error));
      setConfirmDelete(false);
    }
  };

  const submit = async (values: AttributeSetFormValues) => {
    setServerError(null);
    try {
      if (isCreate) {
        const { id } = await create({
          name: values.name,
          attributeIds: attributeIds as Id<"attributeDefinitions">[],
          categoryIds: categoryIds as Id<"categories">[],
        });
        toast.success("Attribute set created");
        onCreated(id);
        return;
      }
      if (set === null) return; // unreachable: handled above
      await update({
        id: set._id,
        name: values.name,
        attributeIds: attributeIds as Id<"attributeDefinitions">[],
        categoryIds: categoryIds as Id<"categories">[],
      });
      toast.success("Attribute set saved");
    } catch (error) {
      setServerError(toUserMessage(error));
      setConfirmDelete(false);
    }
  };

  return (
    <PanelShell
      title={isCreate ? "New attribute set" : (set?.name ?? "Attribute set")}
      description="Attributes a category opts into — its products inherit every one."
      onClose={onClose}
    >
      <Form methods={methods} onSubmit={submit}>
        <div className="space-y-5 p-6">
          {serverError ? <FormAlert message={serverError} /> : null}
          <FormInput name="name" label="Name" placeholder="Physical specs" required />

          <div className="space-y-2">
            <span className="text-primary block text-sm font-medium">
              Attributes <span className="text-tertiary font-normal">— picked in this order</span>
            </span>
            <div className="border-tertiary max-h-64 space-y-2.5 overflow-y-auto rounded-lg border p-3">
              {definitions.length === 0 ? (
                <p className="text-secondary text-sm">
                  No attribute definitions yet — create one with “New attribute”.
                </p>
              ) : (
                definitions.map((row) => (
                  <Checkbox
                    key={row._id}
                    label={row.name}
                    hint={
                      row.unit
                        ? `${ATTRIBUTE_TYPE_LABELS[row.type]} · ${row.unit}`
                        : ATTRIBUTE_TYPE_LABELS[row.type]
                    }
                    isSelected={attributeIds.includes(row._id)}
                    onChange={(selected) => toggleAttribute(row._id, selected)}
                  />
                ))
              )}
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-primary block text-sm font-medium">
              Categories{" "}
              <span className="text-tertiary font-normal">
                — products here inherit these fields
              </span>
            </span>
            <div className="border-tertiary max-h-56 space-y-2.5 overflow-y-auto rounded-lg border p-3">
              {categories.length === 0 ? (
                <p className="text-secondary text-sm">No categories yet.</p>
              ) : (
                categories.map((row) => (
                  <Checkbox
                    key={row._id}
                    label={`${"— ".repeat(Math.max(0, row.depth - 1))}${row.name}`}
                    isSelected={categoryIds.includes(row._id)}
                    onChange={(selected) => toggleCategory(row._id, selected)}
                  />
                ))
              )}
            </div>
          </div>
        </div>
        <PanelFooter
          showDelete={!isCreate && canDelete}
          confirmDelete={confirmDelete}
          onDelete={handleDelete}
          onArmDelete={() => setConfirmDelete(true)}
          isSaving={methods.formState.isSubmitting}
          onClose={onClose}
        />
      </Form>
    </PanelShell>
  );
}

/* ------------------------------------------------------------------ lists */

/** One row of either list: click to edit, selected → brand tint. */
export function EntityRow({
  selected,
  name,
  meta,
  badge,
  onClick,
}: {
  selected: boolean;
  name: string;
  meta?: string;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left",
        selected ? "bg-brand-50" : "hover:bg-secondary",
      )}
    >
      <span
        className={cx(
          "min-w-0 flex-1 truncate text-sm font-medium",
          selected ? "text-brand-600" : "text-primary",
        )}
      >
        {name}
      </span>
      {meta ? (
        <span className="text-tertiary hidden truncate text-xs sm:inline">{meta}</span>
      ) : null}
      {badge ? (
        <Badge color="gray" size="sm">
          {badge}
        </Badge>
      ) : null}
    </button>
  );
}
