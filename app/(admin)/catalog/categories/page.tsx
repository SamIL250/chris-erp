"use client";

import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, EyeOff, Plus } from "@untitledui/icons";
import { useMutation, useQuery } from "convex/react";
import { useState, type ReactNode } from "react";
import { EmptyState } from "@/components/application/empty-state/empty-state";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Card } from "@/components/ui/card";
import {
  Form,
  FormAlert,
  FormCheckbox,
  FormInput,
  FormSelect,
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
import { categorySchema } from "@/lib/schemas/categories";
import { slugify } from "@/lib/slug";
import { cx } from "@/utils/cx";

/**
 * Category admin UI (PH1-02): the tree on the left, a persistent side
 * editor on the right (create/edit/move/delete without leaving the page).
 *
 * - The tree renders the DFS-ordered `categories:list` rows; collapsing
 *   hides descendants via each row's computed `path` (no stored tree).
 * - Product counts + the "Uncategorized" bucket come from
 *   `categories:stats` — draft+active products only (archived are hidden
 *   everywhere, PH1-15); a product in several categories counts in each.
 * - Permission gating mirrors the server: no create/edit/delete buttons
 *   without `catalog.create/edit/delete`; view-only roles get a read-only
 *   summary panel instead of the form. Server errors surface via
 *   `toUserMessage` (form alert for saves, toast for row actions).
 */

/** Select id for "no parent" — keeps the option a real, selectable item. */
const ROOT_PARENT = "__root__";

type CategoryRow = Doc<"categories"> & { depth: number; path: Id<"categories">[] };

type EditorState =
  { mode: "create"; parentId?: Id<"categories"> } | { mode: "edit"; id: Id<"categories"> };

/* ------------------------------------------------------------------ tree */

function TreeRow({
  row,
  selected,
  count,
  expandable,
  expanded,
  canCreate,
  onToggle,
  onSelect,
  onCreate,
}: {
  row: CategoryRow;
  selected: boolean;
  count: number;
  expandable: boolean;
  expanded: boolean;
  canCreate: boolean;
  onToggle: (id: Id<"categories">) => void;
  onSelect: (row: CategoryRow) => void;
  onCreate: (parentId: Id<"categories">) => void;
}) {
  return (
    <div
      className={cx("flex items-center gap-1 rounded-lg pr-2", selected && "bg-brand-50")}
      style={{ paddingLeft: 4 + (row.depth - 1) * 16 }}
    >
      {expandable ? (
        <Button
          color="tertiary"
          size="sm"
          noTextPadding
          iconLeading={expanded ? ChevronDown : ChevronRight}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${row.name}`}
          onPress={() => onToggle(row._id)}
        />
      ) : (
        <span className="size-7 shrink-0" aria-hidden />
      )}
      <button
        type="button"
        onClick={() => onSelect(row)}
        className="min-w-0 flex-1 rounded-md px-1 py-1.5 text-left"
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span
            className={cx(
              "truncate text-sm font-medium",
              selected ? "text-brand-600" : "text-primary",
            )}
          >
            {row.name}
          </span>
          <span className="text-tertiary hidden truncate font-mono text-xs sm:inline">
            {row.slug}
          </span>
        </span>
      </button>
      {!row.visible ? (
        <span className="text-tertiary shrink-0" title="Hidden from the storefront">
          <EyeOff className="size-4" />
          <span className="sr-only">Hidden from the storefront</span>
        </span>
      ) : null}
      <span className="shrink-0">
        <Badge color="gray" size="sm">
          {count}
        </Badge>
      </span>
      {canCreate ? (
        <Button
          color="tertiary"
          size="sm"
          noTextPadding
          iconLeading={Plus}
          aria-label={`Add a subcategory under ${row.name}`}
          onPress={() => onCreate(row._id)}
        />
      ) : null}
    </div>
  );
}

function CategoryTree({
  rows,
  byCategory,
  uncategorized,
  selectedId,
  collapsed,
  canCreate,
  onToggle,
  onSelect,
  onCreate,
}: {
  rows: CategoryRow[];
  byCategory: Record<string, number>;
  uncategorized: number;
  selectedId: Id<"categories"> | null;
  collapsed: ReadonlySet<string>;
  canCreate: boolean;
  onToggle: (id: Id<"categories">) => void;
  onSelect: (row: CategoryRow) => void;
  onCreate: (parentId?: Id<"categories">) => void;
}) {
  const parentIds = new Set<string>();
  for (const row of rows) if (row.parentId !== undefined) parentIds.add(row.parentId);
  const isHidden = (row: CategoryRow) =>
    row.path.slice(0, -1).some((ancestor) => collapsed.has(ancestor));

  return (
    <Card>
      {rows.length === 0 ? (
        <div className="px-6 py-10">
          <EmptyState size="md">
            <EmptyState.Header>
              <EmptyState.FeaturedIcon color="gray" />
            </EmptyState.Header>
            <EmptyState.Content>
              <EmptyState.Title>No categories yet</EmptyState.Title>
              <EmptyState.Description>
                {canCreate
                  ? "Group your catalog — create the first top-level category to get started."
                  : "An administrator can create categories from this page."}
              </EmptyState.Description>
            </EmptyState.Content>
            {canCreate ? (
              <EmptyState.Footer>
                <Button color="primary" onPress={() => onCreate()}>
                  New category
                </Button>
              </EmptyState.Footer>
            ) : null}
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="border-tertiary border-b px-3 py-2">
            <div className="text-tertiary flex items-center gap-2 text-xs font-medium">
              <span className="flex-1 pl-7">Category</span>
              <span>Products</span>
            </div>
          </div>
          <div className="space-y-0.5 p-2">
            {rows.map((row) =>
              isHidden(row) ? null : (
                <TreeRow
                  key={row._id}
                  row={row}
                  selected={selectedId === row._id}
                  count={byCategory[row._id] ?? 0}
                  expandable={parentIds.has(row._id)}
                  expanded={!collapsed.has(row._id)}
                  canCreate={canCreate}
                  onToggle={onToggle}
                  onSelect={onSelect}
                  onCreate={onCreate}
                />
              ),
            )}
          </div>
        </>
      )}
      <div className="border-tertiary flex items-center justify-between gap-3 border-t px-4 py-3">
        <div className="min-w-0">
          <span className="text-primary block text-sm font-medium">Uncategorized</span>
          <span className="text-secondary text-xs">
            Products with no category — assign one from the product editor.
          </span>
        </div>
        <Badge color={uncategorized > 0 ? "brand" : "gray"} size="sm">
          {uncategorized}
        </Badge>
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------- editor */

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

function ReadonlyEditor({
  row,
  rows,
  byCategory,
  onClose,
}: {
  row: CategoryRow;
  rows: CategoryRow[];
  byCategory: Record<string, number>;
  onClose: () => void;
}) {
  const parent =
    row.parentId === undefined ? null : (rows.find((r) => r._id === row.parentId) ?? null);
  const siblings = rows
    .filter((candidate) => (candidate.parentId ?? null) === (row.parentId ?? null))
    .sort((a, b) => a.position - b.position);
  const index = siblings.findIndex((candidate) => candidate._id === row._id);

  const facts: { label: string; value: string; mono?: boolean; storefront?: boolean }[] = [
    { label: "Slug", value: row.slug, mono: true },
    { label: "Parent", value: parent?.name ?? "(Top level)" },
    { label: "Position", value: `${index + 1} of ${siblings.length} at this level` },
    { label: "Storefront", value: row.visible ? "Visible" : "Hidden", storefront: row.visible },
    { label: "Products", value: String(byCategory[row._id] ?? 0) },
    ...(row.seoTitle ? [{ label: "SEO title", value: row.seoTitle }] : []),
    ...(row.seoDescription ? [{ label: "SEO description", value: row.seoDescription }] : []),
    ...(row.description ? [{ label: "Description", value: row.description }] : []),
  ];

  return (
    <PanelShell
      title={row.name}
      description="View only — your role can read the catalog but not change it."
      onClose={onClose}
    >
      <dl className="space-y-3 p-6">
        {facts.map((fact) => (
          <div key={fact.label} className="flex items-start justify-between gap-4">
            <dt className="text-tertiary shrink-0 text-sm">{fact.label}</dt>
            <dd className="text-primary min-w-0 text-right text-sm break-words">
              {fact.storefront !== undefined ? (
                <Badge color={fact.storefront ? "success" : "gray"} size="sm">
                  {fact.value}
                </Badge>
              ) : fact.mono ? (
                <span className="font-mono text-xs">{fact.value}</span>
              ) : (
                fact.value
              )}
            </dd>
          </div>
        ))}
      </dl>
    </PanelShell>
  );
}

function CategoryEditor({
  state,
  rows,
  byCategory,
  canEdit,
  canDelete,
  onClose,
  onCreated,
}: {
  state: EditorState;
  rows: CategoryRow[];
  byCategory: Record<string, number>;
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
  onCreated: (id: Id<"categories">) => void;
}) {
  const create = useMutation(api.catalog.categories.create);
  const update = useMutation(api.catalog.categories.update);
  const move = useMutation(api.catalog.categories.move);
  const remove = useMutation(api.catalog.categories.remove);
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isCreate = state.mode === "create";
  const row = isCreate ? null : (rows.find((candidate) => candidate._id === state.id) ?? null);

  const methods = useZodForm(categorySchema, {
    defaultValues: {
      name: row?.name ?? "",
      slug: row?.slug ?? "",
      parentId: isCreate ? (state.parentId ?? ROOT_PARENT) : (row?.parentId ?? ROOT_PARENT),
      description: row?.description ?? "",
      seoTitle: row?.seoTitle ?? "",
      seoDescription: row?.seoDescription ?? "",
      visible: row?.visible ?? true,
    },
  });
  const nameValue = methods.watch("name") ?? "";
  const slugPreview = slugify(nameValue);

  // Deleted while open: say so instead of rendering an empty form.
  if (!isCreate && row === null) {
    return (
      <PanelShell title="Category not found" onClose={onClose}>
        <p className="text-secondary p-6 text-sm">
          It was deleted — pick another one from the tree.
        </p>
      </PanelShell>
    );
  }

  // View-only roles get facts, not a form (the server would refuse anyway).
  if (row !== null && !canEdit) {
    return <ReadonlyEditor row={row} rows={rows} byCategory={byCategory} onClose={onClose} />;
  }

  const parentName =
    state.mode === "create" && state.parentId !== undefined
      ? (rows.find((candidate) => candidate._id === state.parentId)?.name ?? null)
      : null;

  // Never offer self or a descendant as the new parent (cycle guard UX;
  // the server enforces it regardless).
  const excluded = new Set<string>();
  if (row !== null) {
    for (const candidate of rows) {
      if (candidate.path.includes(row._id)) excluded.add(candidate._id);
    }
  }
  const parentItems = [
    { id: ROOT_PARENT, label: "(Top level)" },
    ...rows
      .filter((candidate) => !excluded.has(candidate._id))
      .map((candidate) => ({
        id: candidate._id as string,
        label: `${"— ".repeat(candidate.depth - 1)}${candidate.name}`,
      })),
  ];

  const siblings =
    row === null
      ? []
      : rows
          .filter((candidate) => (candidate.parentId ?? null) === (row.parentId ?? null))
          .sort((a, b) => a.position - b.position || a._creationTime - b._creationTime);
  const siblingIndex = row === null ? -1 : siblings.findIndex((c) => c._id === row._id);

  const handleMove = async (delta: number) => {
    if (row === null) return;
    try {
      await move({
        id: row._id,
        ...(row.parentId !== undefined ? { newParentId: row.parentId } : {}),
        position: row.position + delta,
      });
    } catch (error) {
      toast.error(toUserMessage(error));
    }
  };

  const handleDelete = async () => {
    if (row === null) return;
    try {
      await remove({ id: row._id });
      toast.success("Category deleted");
      onClose();
    } catch (error) {
      toast.error(toUserMessage(error));
      setConfirmDelete(false);
    }
  };

  const submit = async (values: {
    name: string;
    slug: string;
    parentId: string;
    description: string;
    seoTitle: string;
    seoDescription: string;
    visible: boolean;
  }) => {
    setServerError(null);
    const parentId =
      values.parentId === ROOT_PARENT ? undefined : (values.parentId as Id<"categories">);
    try {
      if (isCreate) {
        const { id } = await create({
          name: values.name,
          slug: values.slug || undefined,
          ...(parentId !== undefined ? { parentId } : {}),
          description: values.description || undefined,
          seoTitle: values.seoTitle || undefined,
          seoDescription: values.seoDescription || undefined,
          visible: values.visible,
        });
        toast.success("Category created");
        onCreated(id);
        return;
      }
      if (row === null) return;
      // Update is full-form (omitted optional clears) EXCEPT `slug`, where
      // "" deliberately re-derives from the name — that field always sends
      // its value so the intent stays visible in the payload.
      const reparent = parentId !== row.parentId;
      await update({
        id: row._id,
        name: values.name,
        slug: values.slug,
        description: values.description || undefined,
        seoTitle: values.seoTitle || undefined,
        seoDescription: values.seoDescription || undefined,
        visible: values.visible,
      });
      if (reparent) {
        await move({
          id: row._id,
          ...(parentId !== undefined ? { newParentId: parentId } : {}),
          position: row.position,
        });
      }
      toast.success(reparent ? "Category saved and moved" : "Category saved");
    } catch (error) {
      setServerError(toUserMessage(error));
      setConfirmDelete(false);
    }
  };

  const title = isCreate
    ? parentName !== null
      ? `New subcategory — ${parentName}`
      : "New category"
    : (row?.name ?? "Category");

  return (
    <PanelShell
      title={title}
      description={
        isCreate
          ? "Nested up to 6 levels deep; the slug becomes its storefront address."
          : row !== null
            ? row.visible
              ? "Visible on the storefront."
              : "Hidden from the storefront."
            : undefined
      }
      onClose={onClose}
    >
      <Form methods={methods} onSubmit={submit}>
        <div className="space-y-5 p-6">
          {serverError ? <FormAlert message={serverError} /> : null}
          <FormInput name="name" label="Name" placeholder="Ultrasound Systems" required />
          <FormInput
            name="slug"
            label="Slug"
            placeholder={slugPreview || "ultrasound-systems"}
            hint={
              isCreate
                ? slugPreview
                  ? `Leave empty to use "${slugPreview}".`
                  : "Leave empty to derive it from the name."
                : "Changing the slug changes the storefront URL — leave empty to re-derive from the name."
            }
          />
          <FormSelect
            name="parentId"
            label="Parent"
            items={parentItems}
            hint="Top level, or nested under another category."
          />
          <FormCheckbox name="visible" label="Visible — shown in the storefront" />
          <FormTextarea
            name="description"
            label="Description"
            rows={4}
            placeholder="What this category covers…"
          />
          <div className="space-y-4">
            <h3 className="text-primary text-sm font-semibold">SEO</h3>
            <FormInput
              name="seoTitle"
              label="SEO title"
              placeholder="Page title — defaults to the category name"
            />
            <FormTextarea
              name="seoDescription"
              label="SEO description"
              rows={2}
              placeholder="Search-result summary…"
            />
          </div>
          {!isCreate && row !== null && siblingIndex >= 0 && siblings.length > 1 ? (
            <div className="border-tertiary flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
              <span className="text-secondary text-sm">
                Position {siblingIndex + 1} of {siblings.length} at this level
              </span>
              <div className="flex gap-2">
                <Button
                  color="secondary"
                  size="sm"
                  iconLeading={ArrowUp}
                  isDisabled={siblingIndex <= 0}
                  onPress={() => handleMove(-1)}
                >
                  Up
                </Button>
                <Button
                  color="secondary"
                  size="sm"
                  iconLeading={ArrowDown}
                  isDisabled={siblingIndex >= siblings.length - 1}
                  onPress={() => handleMove(1)}
                >
                  Down
                </Button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="border-tertiary flex items-center justify-between gap-3 border-t px-6 py-4">
          <div>
            {canDelete && row !== null ? (
              confirmDelete ? (
                <Button color="tertiary" className="text-error" onPress={handleDelete}>
                  Confirm delete
                </Button>
              ) : (
                <Button
                  color="tertiary"
                  className="text-error"
                  onPress={() => setConfirmDelete(true)}
                >
                  Delete
                </Button>
              )
            ) : null}
          </div>
          <div className="flex gap-3">
            <Button color="secondary" onPress={onClose}>
              Cancel
            </Button>
            <Button type="submit" color="primary" isLoading={methods.formState.isSubmitting}>
              Save
            </Button>
          </div>
        </div>
      </Form>
    </PanelShell>
  );
}

/* ----------------------------------------------------------------- page */

export default function CategoriesPage() {
  const categories = useQuery(api.catalog.categories.list);
  const stats = useQuery(api.catalog.categories.stats);
  const canCreate = useCan("catalog", "create");
  const canEdit = useCan("catalog", "edit");
  const canDelete = useCan("catalog", "delete");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  if (categories === undefined || stats === undefined) {
    return (
      <div className="flex max-w-6xl flex-col gap-6">
        <PageHeader
          title="Categories"
          description="The category tree behind the storefront — nesting, slugs, SEO and visibility."
        />
        <Skeleton className="h-96" />
      </div>
    );
  }

  const toggleCollapsed = (id: Id<"categories">) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const createEditor = (parentId?: Id<"categories">) =>
    setEditor({ mode: "create", ...(parentId !== undefined ? { parentId } : {}) });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Categories"
        description="The category tree behind the storefront — nesting, slugs, SEO and visibility."
        actions={
          canCreate ? (
            <Button color="primary" onPress={() => createEditor()}>
              New category
            </Button>
          ) : null
        }
      />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] xl:grid-cols-[minmax(0,1fr)_28rem]">
        <CategoryTree
          rows={categories}
          byCategory={stats.byCategory}
          uncategorized={stats.uncategorized}
          selectedId={editor?.mode === "edit" ? editor.id : null}
          collapsed={collapsed}
          canCreate={canCreate}
          onToggle={toggleCollapsed}
          onSelect={(row) => setEditor({ mode: "edit", id: row._id })}
          onCreate={createEditor}
        />
        <div className="lg:sticky lg:top-6">
          {editor === null ? (
            <Card>
              <div className="space-y-3 p-6">
                <h2 className="text-md text-primary font-semibold">Edit a category</h2>
                <p className="text-secondary text-sm">
                  Pick a row to edit its name, slug, parent and SEO here — or create the first
                  category.
                </p>
                {canCreate ? (
                  <Button color="primary" size="sm" onPress={() => createEditor()}>
                    New category
                  </Button>
                ) : (
                  <p className="text-tertiary text-sm">
                    You can view the catalog but not change it.
                  </p>
                )}
              </div>
            </Card>
          ) : (
            <CategoryEditor
              key={editor.mode === "edit" ? editor.id : `create:${editor.parentId ?? ""}`}
              state={editor}
              rows={categories}
              byCategory={stats.byCategory}
              canEdit={canEdit}
              canDelete={canDelete}
              onClose={() => setEditor(null)}
              onCreated={(id) => setEditor({ mode: "edit", id })}
            />
          )}
        </div>
      </div>
    </div>
  );
}
