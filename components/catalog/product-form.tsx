"use client";

import { Image01 } from "@untitledui/icons";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { MediaGallery, type GalleryImage } from "@/components/catalog/media-gallery";
import { ProductCover } from "@/components/catalog/product-cover";
import { ProductVendors } from "@/components/catalog/product-vendors";
import { RichTextEditor } from "@/components/catalog/rich-text-editor";
import { usePageLabel } from "@/components/shared/page-label";
import { useProductCovers } from "@/hooks/use-product-covers";
import { Card } from "@/components/ui/card";
import {
  Form,
  FormAlert,
  FormInput,
  FormSelect,
  FormTextarea,
  useZodForm,
} from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { orderApplicableAttributes } from "@/lib/attributes";
import { toUserMessage } from "@/lib/errors";
import { imageAltError } from "@/lib/images";
import { marginPercent } from "@/lib/pricing";
import { ATTRIBUTE_TYPE_LABELS } from "@/lib/schemas/attributes";
import {
  PRODUCT_STATUS_LABELS,
  PRODUCT_STATUSES,
  TAX_CATEGORIES,
  TAX_CATEGORY_LABELS,
  dateToInput,
  inputToDate,
  productDefaults,
  productSchema,
  type ProductFormValues,
} from "@/lib/schemas/products";
import { normalizeUoMCode, uomCodeError, validateConversions, validateDocUoM } from "@/lib/uom";
import { cx } from "@/utils/cx";

/**
 * Product editor form (PH1-07): sections Basic · Pricing · Attributes ·
 * Inventory/Tracking · Media · SEO, with draft autosave.
 *
 * Data flow:
 * - zod-backed fields live in `useZodForm(productSchema)`; checkbox groups
 *   (categories, sets), the DYNAMIC attribute values, and UoM CONVERSION
 *   rows are sibling state — merged into one payload by
 *   `buildProductArgs`, exactly like the PH1-04 set panel keeps its id
 *   lists outside the schema;
 * - applicable attributes come from `orderApplicableAttributes` — the same
 *   pure ordering the mutation validates against (`lib/attributes.ts`), so
 *   the form can render inputs for a product that doesn't exist yet;
 * - AUTOSAVE: any change (form watch + state setters) marks dirty and
 *   debounces a save. Quiet `productSchema.safeParse` gates it — invalid
 *   drafts stay local until blur/submit show their errors, so typing never
 *   spams banners. First save in create mode inserts, then does a SHALLOW
 *   `history.replaceState` to the new URL: no route change, so focus and
 *   caret survive; later saves update (no-op saves record nothing —
 *   PH0-30 — which is what makes autosave audit-safe).
 * - `attributeValues` is ALWAYS sent as a full replace (this form owns the
 *   section); the server diffs it against stored rows.
 *
 * View-only roles never reach this component (the editor shell renders
 * `ProductFacts` instead); `canDelete` gates the two-step delete zone.
 */

const AUTOSAVE_MS = 1500;

type CategoryRow = Doc<"categories"> & { depth: number; path: Id<"categories">[] };
type ValueMap = Record<string, string | boolean | string[]>;
type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

type ValueEntry = {
  attributeId: Id<"attributeDefinitions">;
  value: string | number | boolean;
};

/** A conversion row as edited — factor stays a string until build parse. */
type ConversionRow = { unit: string; parent: string; factor: string };

/** Stored value rows → initial editor state (multi-select collects rows). */
function seedValues(
  rows: Doc<"attributeValues">[],
  definitions: Doc<"attributeDefinitions">[],
): ValueMap {
  const byId = new Map(definitions.map((row) => [row._id, row]));
  const map: ValueMap = {};
  for (const row of rows) {
    if (row.valueBoolean !== undefined) {
      map[row.attributeId] = row.valueBoolean;
    } else if (row.valueNumber !== undefined) {
      map[row.attributeId] = String(row.valueNumber);
    } else if (row.valueDate !== undefined) {
      map[row.attributeId] = dateToInput(row.valueDate);
    } else if (row.valueText !== undefined) {
      const current = map[row.attributeId];
      if (byId.get(row.attributeId)?.type === "multi_select") {
        map[row.attributeId] = [...(Array.isArray(current) ? current : []), row.valueText];
      } else {
        map[row.attributeId] = row.valueText;
      }
    }
  }
  return map;
}

/** Section chrome: card + heading, matching the admin card language. */
function Section({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Card>
      <div className="border-tertiary border-b px-6 py-4">
        <h2 className="text-primary text-md font-semibold">{title}</h2>
        <p className="text-secondary mt-0.5 text-sm">{description}</p>
      </div>
      <div className="space-y-5 p-6">{children}</div>
      {footer}
    </Card>
  );
}

export function ProductForm({
  product,
  storedValues,
  definitions,
  sets,
  categories,
  canCreate,
  canDelete,
}: {
  product: Doc<"products"> | null;
  storedValues: Doc<"attributeValues">[];
  definitions: Doc<"attributeDefinitions">[];
  sets: Doc<"attributeSets">[];
  categories: CategoryRow[];
  canCreate: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const createMutation = useMutation(api.catalog.products.create);
  const updateMutation = useMutation(api.catalog.products.update);
  const removeMutation = useMutation(api.catalog.products.remove);
  const duplicateMutation = useMutation(api.catalog.products.duplicate);
  const removeFile = useMutation(api.files.remove);

  const methods = useZodForm(productSchema, { defaultValues: productDefaults(product) });

  const [createdId, setCreatedId] = useState<Id<"products"> | null>(null);
  const targetId = product?._id ?? createdId;
  const covers = useProductCovers(targetId === null ? [] : [targetId]);

  const [categoryIds, setCategoryIds] = useState<string[]>(() => [...(product?.categoryIds ?? [])]);
  const [attributeSetIds, setAttributeSetIds] = useState<string[]>(() => [
    ...(product?.attributeSetIds ?? []),
  ]);
  const [images, setImages] = useState<GalleryImage[]>(() => [...(product?.images ?? [])]);
  // Files removed in the editor (PH1-13): deleted only AFTER a save
  // excludes them — a failed or in-flight save may still reference them.
  const [removedFileIds, setRemovedFileIds] = useState<Id<"files">[]>([]);
  const [valuesMap, setValuesMap] = useState<ValueMap>(() => seedValues(storedValues, definitions));

  // Pack conversions (PH1-11) are string-row state (factor parsed at build
  // like every other form input), outside zod — the chain/membership rules
  // need base + rows together and run in `buildProductArgs` via `lib/uom`,
  // so an invalid row surfaces through the same save-error alert as a bad
  // dynamic attribute value.
  const [conversions, setConversions] = useState<ConversionRow[]>(() =>
    (product?.conversions ?? []).map((row) => ({
      unit: row.unit,
      parent: row.parent,
      factor: String(row.factor),
    })),
  );

  const [serverError, setServerError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  // Always-callable trampoline: the debounced timer and the form-watch
  // subscription fire from stale closures otherwise (targetId flips after
  // the first create). Reassigned every render — always the latest work.
  const latestAutosave = useRef<() => void>(() => {});

  const applicable = useMemo(
    () => orderApplicableAttributes(sets, definitions, { categoryIds, attributeSetIds }),
    [sets, definitions, categoryIds, attributeSetIds],
  );

  const markDirty = useCallback(() => {
    setSaveState((current) => (current === "saving" ? current : "dirty"));
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => latestAutosave.current(), AUTOSAVE_MS);
  }, []);

  useEffect(() => {
    const subscription = methods.watch(() => markDirty());
    return () => subscription.unsubscribe();
  }, [methods, markDirty]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  /* ------------------------------------------------------------- payload */

  const buildProductArgs = (
    values: ProductFormValues,
  ): { args: Parameters<typeof createMutation>[0] } | { invalid: string } => {
    const entries: ValueEntry[] = [];
    for (const definition of applicable) {
      const raw = valuesMap[definition._id];
      if (raw === undefined) continue;
      if (definition.type === "multi_select") {
        for (const option of Array.isArray(raw) ? raw : []) {
          entries.push({ attributeId: definition._id, value: option });
        }
      } else if (definition.type === "boolean") {
        entries.push({ attributeId: definition._id, value: raw === true });
      } else {
        const text = typeof raw === "string" ? raw.trim() : "";
        if (text === "") continue;
        if (definition.type === "number") {
          const parsed = Number(text);
          if (!Number.isFinite(parsed)) {
            return { invalid: `${definition.name} expects a number value.` };
          }
          entries.push({ attributeId: definition._id, value: parsed });
        } else if (definition.type === "date") {
          const epoch = inputToDate(text);
          if (!Number.isFinite(epoch)) {
            return { invalid: `${definition.name} expects a date value.` };
          }
          entries.push({ attributeId: definition._id, value: epoch });
        } else {
          entries.push({ attributeId: definition._id, value: text });
        }
      }
    }

    // UoM (PH1-11): normalize the base, validate the chain against it, then
    // the doc-level defaults — SAME lib/uom calls the mutation makes, so a
    // blocked save shows the exact message the server would have thrown.
    const base = values.unitOfMeasure.trim() === "" ? "" : normalizeUoMCode(values.unitOfMeasure);
    const conversionsResult = validateConversions(
      base,
      conversions.map((row) => ({
        unit: row.unit,
        parent: row.parent,
        factor: row.factor.trim() === "" ? Number.NaN : Number(row.factor),
      })),
    );
    if (conversionsResult.error !== null) return { invalid: conversionsResult.error };
    const purchase = validateDocUoM(
      "Purchase UoM",
      values.purchaseUoM,
      base,
      conversionsResult.rows,
    );
    if (purchase.error !== null) return { invalid: purchase.error };
    const sales = validateDocUoM("Sales UoM", values.salesUoM, base, conversionsResult.rows);
    if (sales.error !== null) return { invalid: sales.error };

    // Images (PH1-13): alt rules run through the SAME lib/images call the
    // mutation makes, so a too-long description blocks the save with the
    // exact server message (quiet-gate pattern like the UoM checks above).
    for (const image of images) {
      const altError = imageAltError(image.alt);
      if (altError !== null) return { invalid: altError };
    }

    return {
      args: {
        name: values.name,
        slug: values.slug.trim() === "" ? undefined : values.slug.trim(),
        sku: values.sku,
        barcode: values.barcode.trim() === "" ? undefined : values.barcode.trim(),
        brand: values.brand.trim() === "" ? undefined : values.brand.trim(),
        listPrice: values.listPrice.trim() === "" ? undefined : Number(values.listPrice),
        costPrice: values.costPrice.trim() === "" ? undefined : Number(values.costPrice),
        shortDescription:
          values.shortDescription.trim() === "" ? undefined : values.shortDescription,
        longDescription: values.longDescription.trim() === "" ? undefined : values.longDescription,
        status: values.status,
        taxCategory: values.taxCategory === "" ? undefined : values.taxCategory,
        serialTracked: values.serialTracked,
        lotTracked: values.lotTracked,
        expiryRequired: values.expiryRequired,
        warrantyEligible: values.warrantyEligible,
        allowBackorder: values.allowBackorder,
        warrantyMonths: values.warrantyMonths === "" ? undefined : Number(values.warrantyMonths),
        shelfLifeDays: values.shelfLifeDays === "" ? undefined : Number(values.shelfLifeDays),
        unitOfMeasure: base === "" ? undefined : base,
        conversions: conversionsResult.rows,
        purchaseUoM: purchase.code ?? undefined,
        salesUoM: sales.code ?? undefined,
        images,
        categoryIds: categoryIds as Id<"categories">[],
        attributeSetIds: attributeSetIds as Id<"attributeSets">[],
        seoTitle: values.seoTitle.trim() === "" ? undefined : values.seoTitle,
        seoDescription: values.seoDescription.trim() === "" ? undefined : values.seoDescription,
        attributeValues: entries,
      },
    };
  };

  const doSave = async (values: ProductFormValues, silent: boolean): Promise<void> => {
    if (savingRef.current) return; // never overlap autosaves (double-create risk)
    const built = buildProductArgs(values);
    if ("invalid" in built) {
      setServerError(built.invalid);
      setSaveState("error");
      return;
    }
    savingRef.current = true;
    setSaveState("saving");
    try {
      if (targetId === null) {
        const { id } = await createMutation(built.args);
        setCreatedId(id);
        // Shallow URL sync — the [id] route renders this same form after a
        // reload; here, no remount means no lost focus mid-typing.
        window.history.replaceState(window.history.state, "", `/catalog/products/${id}`);
        if (!silent) toast.success("Product created");
      } else {
        await updateMutation({ id: targetId, ...built.args });
        if (!silent) toast.success("Product saved");
      }
      setServerError(null);
      setSaveState("saved");
      // Detached images (PH1-13): once a save EXCLUDES them they're
      // unreferenced — delete the rows (+ Cloudinary assets), best-effort.
      // A file this save still carried stays queued for the next one.
      const savedIds = new Set(built.args.images.map((image) => image.fileId));
      const doomed = removedFileIds.filter((fileId) => !savedIds.has(fileId));
      if (doomed.length > 0) {
        setRemovedFileIds((prev) => prev.filter((fileId) => !savedIds.has(fileId)));
        for (const fileId of doomed) void removeFile({ fileId }).catch(() => {});
      }
    } catch (error) {
      setServerError(toUserMessage(error));
      setSaveState("error");
    } finally {
      savingRef.current = false;
    }
  };

  // Latest-render trampoline target (see latestAutosave above). Re-armed
  // after every render so the debounced timer never calls a stale closure.
  useEffect(() => {
    latestAutosave.current = () => {
      const parsed = productSchema.safeParse(methods.getValues());
      if (!parsed.success) return; // quiet gate: invalid drafts wait for blur/submit
      void doSave(parsed.data, true);
    };
  });

  const submit = (values: ProductFormValues) => doSave(values, false);

  /* ------------------------------------------------------------ mutations */

  const toggleIdList = (
    current: string[],
    setter: (next: string[]) => void,
    id: string,
    selected: boolean,
  ) => {
    setter(selected ? [...current, id] : current.filter((item) => item !== id));
    markDirty();
  };

  const setAttributeValue = (
    attributeId: Id<"attributeDefinitions">,
    value: string | boolean | string[] | undefined,
  ) => {
    setValuesMap((current) => {
      const next = { ...current };
      if (value === undefined) delete next[attributeId];
      else next[attributeId] = value;
      return next;
    });
    markDirty();
  };

  /* --------------------------------------------------------- conversions */

  /** Watched base UoM code ("" = unset) — rows and selects derive from it. */
  const baseCode = normalizeUoMCode(methods.watch("unitOfMeasure"));

  const setConversion = (index: number, field: keyof ConversionRow, value: string) => {
    setConversions((current) =>
      current.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    );
    markDirty();
  };

  // New rows default their parent to the base (the common `box → each`
  // shape) — blocked until a base exists, since chains must resolve to it.
  const addConversion = () => {
    setConversions((current) => [...current, { unit: "", parent: baseCode, factor: "" }]);
    markDirty();
  };

  const removeConversion = (index: number) => {
    setConversions((current) => current.filter((_, i) => i !== index));
    markDirty();
  };

  /* ----------------------------------------------------------- images */

  const changeImages = (next: GalleryImage[]) => {
    setImages(next);
    markDirty();
  };

  const removeImage = (fileId: Id<"files">) => {
    setImages((current) => current.filter((image) => image.fileId !== fileId));
    // Deferred delete (see state note): the row + asset go only after a
    // save that excludes the file — never while one may still reference it.
    setRemovedFileIds((current) => (current.includes(fileId) ? current : [...current, fileId]));
    markDirty();
  };

  /**
   * Parent choices for row i: the base + every OTHER row's unit — never
   * self, never an invalid code. Offering only reachable parents means a
   * fresh row can't construct a dangling chain in the first place.
   */
  const parentOptions = (index: number): string[] => {
    const self = normalizeUoMCode(conversions[index].unit);
    const others = conversions
      .filter((_, i) => i !== index)
      .map((row) => normalizeUoMCode(row.unit));
    return [...new Set([baseCode, ...others])].filter(
      (option) => option !== "" && option !== self && uomCodeError(option, "UoM") === null,
    );
  };

  /** Doc-level UoM choices: exactly what's convertible — base + units. */
  const docUoMItems = [
    ...new Set([baseCode, ...conversions.map((row) => normalizeUoMCode(row.unit))]),
  ]
    .filter((option) => option !== "" && uomCodeError(option, "UoM") === null)
    .map((option) => ({ id: option, label: option }));

  const handleDelete = async () => {
    if (targetId === null) return;
    try {
      await removeMutation({ id: targetId });
      toast.success("Product deleted");
      router.push("/catalog/products");
    } catch (error) {
      toast.error(toUserMessage(error));
      setConfirmDelete(false);
    }
  };

  /* ----------------------------------------------------------------- view */

  const displayName = methods.watch("name").trim();
  const title = displayName !== "" ? displayName : product === null ? "New product" : "Product";
  const indicator =
    saveState === "saving"
      ? "Saving…"
      : saveState === "saved"
        ? "Saved"
        : saveState === "error"
          ? "Couldn't save — see below"
          : saveState === "dirty"
            ? "Unsaved changes"
            : "";

  usePageLabel(title);

  const status = methods.watch("status");
  // Pricing (PH1-10): margin derives from the two watched price fields —
  // the server never stores it, and null hides the row rather than faking 0.
  const margin = marginPercent(
    methods.watch("listPrice") === "" ? undefined : Number(methods.watch("listPrice")),
    methods.watch("costPrice") === "" ? undefined : Number(methods.watch("costPrice")),
  );

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={title}
        description={
          product === null && createdId === null
            ? "New catalog item — fill in the basics and it saves as you go."
            : "Catalog item — changes save automatically as you type."
        }
        leading={
          targetId === null ? undefined : (
            <ProductCover src={covers.get(targetId)} className="size-16" />
          )
        }
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {targetId !== null && canCreate ? (
              <Button
                color="secondary"
                size="sm"
                isLoading={duplicating}
                onPress={() => {
                  const id = targetId;
                  setDuplicating(true);
                  void duplicateMutation({ id })
                    .then(({ id: copyId }) => {
                      toast.success("Draft copy created");
                      router.push(`/catalog/products/${copyId}`);
                    })
                    .catch((error: unknown) => {
                      toast.error(toUserMessage(error));
                      setDuplicating(false);
                    });
                }}
              >
                Duplicate
              </Button>
            ) : null}
            {targetId !== null ? (
              <Button
                color="secondary"
                size="sm"
                onPress={() =>
                  methods.setValue("status", status === "archived" ? "draft" : "archived", {
                    shouldDirty: true,
                  })
                }
              >
                {status === "archived" ? "Restore to draft" : "Archive"}
              </Button>
            ) : null}
            {targetId !== null ? (
              <Button color="secondary" size="sm" href={`/catalog/products/${targetId}/variants`}>
                Variants
              </Button>
            ) : null}
            <Badge color={status === "active" ? "brand" : "gray"} size="md">
              {PRODUCT_STATUS_LABELS[status]}
            </Badge>
          </div>
        }
      />

      <Form methods={methods} onSubmit={submit} className="space-y-6">
        {serverError ? <FormAlert message={serverError} /> : null}

        {/* ------------------------------------------------------- Basic */}
        <Section
          title="Basic"
          description="Identity, lifecycle status, and the copy the storefront opens with."
        >
          <FormInput
            name="name"
            label="Name"
            placeholder="Portable Ultrasound X5"
            required
            hint="1–100 characters."
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <FormInput
              name="sku"
              label="SKU"
              placeholder="US-X5-001"
              required
              hint="3–32 characters: letters, numbers, and - . / _ — unique org-wide."
            />
            <FormInput
              name="slug"
              label="Slug"
              placeholder="portable-ultrasound-x5"
              hint="URL segment — leave blank to derive from the name."
            />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormInput
              name="barcode"
              label="Barcode"
              placeholder="4006381333931"
              hint="Optional — scanned lookups (PH1-13)."
            />
            <FormInput name="brand" label="Brand" placeholder="Acme Medical" />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormSelect
              name="status"
              label="Status"
              items={PRODUCT_STATUSES.map((value) => ({
                id: value,
                label: PRODUCT_STATUS_LABELS[value],
              }))}
              hint="Archived products leave pickers and the storefront, and stay recoverable here and under the catalog's Archived filter."
            />
            <FormSelect
              name="taxCategory"
              label="Tax category"
              items={[
                { id: "", label: "None (use category default)" },
                ...TAX_CATEGORIES.map((value) => ({
                  id: value,
                  label: TAX_CATEGORY_LABELS[value],
                })),
              ]}
              hint="Rates come from Settings → Tax (PH0-24)."
            />
          </div>

          <div className="space-y-2">
            <span className="text-primary block text-sm font-medium">
              Categories{" "}
              <span className="text-tertiary font-normal">— where this product appears</span>
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
                    onChange={(selected) =>
                      toggleIdList(categoryIds, setCategoryIds, row._id, selected)
                    }
                  />
                ))
              )}
            </div>
          </div>

          <FormTextarea
            name="shortDescription"
            label="Short description"
            rows={2}
            hint="One-liner for cards and search — up to 300 characters."
          />

          <div className="space-y-2">
            <span className="text-primary block text-sm font-medium">
              Long description <span className="text-tertiary font-normal">— rich text</span>
            </span>
            <RichTextEditor
              value={methods.getValues("longDescription")}
              onChange={(html) => methods.setValue("longDescription", html, { shouldDirty: true })}
            />
            <p className="text-tertiary text-sm">
              Sanitized on save — links, images, lists, and headings h2–h4 only.
            </p>
          </div>
        </Section>

        {/* ----------------------------------------------------- Pricing */}
        <Section title="Pricing" description="What customers pay and what stock costs.">
          <div className="grid gap-5 sm:grid-cols-2">
            <FormInput
              name="listPrice"
              label="List price"
              placeholder="499.00"
              hint="Base sell price — variants override it per combination (PH1-09)."
            />
            <FormInput
              name="costPrice"
              label="Cost price"
              placeholder="320.00"
              hint="Display-only reference cost — the moving average computed from stock receipts takes over in inventory/finance."
            />
          </div>
          <div className="bg-secondary flex items-center justify-between rounded-xl px-4 py-3">
            <span className="text-secondary text-sm">Margin</span>
            {margin === null ? (
              <span className="text-tertiary text-sm">Set list &amp; cost price to see margin</span>
            ) : (
              <span
                className={cx(
                  "text-sm font-medium",
                  margin < 0 ? "text-fg-error-primary" : "text-fg-success-primary",
                )}
              >
                {margin.toFixed(1)}%
              </span>
            )}
          </div>
        </Section>

        {/* --------------------------------------------------- Attributes */}
        <Section
          title="Attributes"
          description="Spec fields from the sets this product’s categories inherit, plus any set you pick directly."
        >
          <div className="space-y-2">
            <span className="text-primary block text-sm font-medium">
              Attribute sets{" "}
              <span className="text-tertiary font-normal">— beyond category inheritance</span>
            </span>
            <div className="border-tertiary max-h-44 space-y-2.5 overflow-y-auto rounded-lg border p-3">
              {sets.length === 0 ? (
                <p className="text-secondary text-sm">No attribute sets yet.</p>
              ) : (
                sets.map((row) => (
                  <Checkbox
                    key={row._id}
                    label={row.name}
                    hint={`${row.attributeIds.length} attribute${row.attributeIds.length === 1 ? "" : "s"}`}
                    isSelected={attributeSetIds.includes(row._id)}
                    onChange={(selected) =>
                      toggleIdList(attributeSetIds, setAttributeSetIds, row._id, selected)
                    }
                  />
                ))
              )}
            </div>
          </div>

          {applicable.length === 0 ? (
            <p className="text-secondary text-sm">
              No attributes apply yet — pick a category that inherits a set, or tick a set above.
            </p>
          ) : (
            <div className="space-y-5">
              {applicable.map((definition) => {
                const raw = valuesMap[definition._id];
                const typeLabel =
                  ATTRIBUTE_TYPE_LABELS[definition.type] +
                  (definition.unit ? ` · ${definition.unit}` : "");
                if (definition.type === "boolean") {
                  return (
                    <Checkbox
                      key={definition._id}
                      label={definition.name}
                      hint={typeLabel}
                      isSelected={raw === true}
                      onChange={(selected) => setAttributeValue(definition._id, selected)}
                    />
                  );
                }
                if (definition.type === "multi_select") {
                  const selected = Array.isArray(raw) ? raw : [];
                  return (
                    <div key={definition._id} className="space-y-2">
                      <span className="text-primary block text-sm font-medium">
                        {definition.name}{" "}
                        <span className="text-tertiary font-normal">— {typeLabel}</span>
                      </span>
                      <div className="border-tertiary space-y-2.5 rounded-lg border p-3">
                        {definition.options.map((option) => (
                          <Checkbox
                            key={option}
                            label={option}
                            isSelected={selected.includes(option)}
                            onChange={(isChecked) =>
                              setAttributeValue(
                                definition._id,
                                isChecked
                                  ? [...selected, option]
                                  : selected.filter((value) => value !== option),
                              )
                            }
                          />
                        ))}
                      </div>
                    </div>
                  );
                }
                if (definition.type === "select") {
                  return (
                    <FormSelectLike
                      key={definition._id}
                      label={definition.name}
                      hint={typeLabel}
                      value={typeof raw === "string" ? raw : ""}
                      options={definition.options}
                      onChange={(value) => setAttributeValue(definition._id, value)}
                    />
                  );
                }
                const text = typeof raw === "string" ? raw : "";
                if (definition.type === "date") {
                  return (
                    <Input
                      key={definition._id}
                      type="date"
                      label={definition.name}
                      hint={typeLabel}
                      value={text}
                      onChange={(value) => setAttributeValue(definition._id, value)}
                    />
                  );
                }
                return (
                  <Input
                    key={definition._id}
                    type={definition.type === "number" ? "number" : "text"}
                    label={definition.name}
                    hint={typeLabel}
                    value={text}
                    onChange={(value) => setAttributeValue(definition._id, value)}
                  />
                );
              })}
            </div>
          )}
        </Section>

        {/* -------------------------------------------- Inventory/Tracking */}
        <Section
          title="Inventory & tracking"
          description="How stock of this item is followed — PH1-12 rules: serial ⊥ lot, expiry needs lot."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Checkbox
              label="Serial tracked"
              hint="Unique serial per unit — replaces lot tracking (serials land PH1-14)."
              isSelected={methods.watch("serialTracked")}
              isDisabled={methods.watch("lotTracked")}
              onChange={(selected) =>
                methods.setValue("serialTracked", selected, { shouldDirty: true })
              }
            />
            <Checkbox
              label="Lot tracked"
              hint="Batch/lot numbers across units — required for expiry dates (PH1-14)."
              isSelected={methods.watch("lotTracked")}
              isDisabled={methods.watch("serialTracked")}
              onChange={(selected) =>
                methods.setValue("lotTracked", selected, { shouldDirty: true })
              }
            />
            <Checkbox
              label="Expiry required"
              hint="Receiving records an expiry date — requires lot tracking (PH1-17)."
              isSelected={methods.watch("expiryRequired")}
              isDisabled={!methods.watch("lotTracked")}
              onChange={(selected) => {
                methods.setValue("expiryRequired", selected, { shouldDirty: true });
                // The shelf-life input only exists alongside expiry — an
                // unchecked flag can't leave an orphaned number behind
                // (lib/tracking rule 4 would reject the save).
                if (!selected) methods.setValue("shelfLifeDays", "", { shouldDirty: true });
              }}
            />
            <Checkbox
              label="Warranty eligible"
              hint="Warranties can attach to sales of this item (PH1-17 claim flow)."
              isSelected={methods.watch("warrantyEligible")}
              onChange={(selected) => {
                methods.setValue("warrantyEligible", selected, { shouldDirty: true });
                // Same dependent clear: no term without eligibility
                // (lib/tracking rule 3 would reject the save).
                if (!selected) methods.setValue("warrantyMonths", "", { shouldDirty: true });
              }}
            />
            <Checkbox
              label="Allow backorder"
              hint="Sales may continue when stock hits zero — enforced from PH2."
              isSelected={methods.watch("allowBackorder")}
              onChange={(selected) =>
                methods.setValue("allowBackorder", selected, { shouldDirty: true })
              }
            />
          </div>
          <div className="grid gap-5 sm:grid-cols-3">
            <FormInput
              name="warrantyMonths"
              label="Warranty (months)"
              type="number"
              placeholder="24"
              hint="0–1200. Needs warranty eligible."
              isDisabled={!methods.watch("warrantyEligible")}
            />
            <FormInput
              name="shelfLifeDays"
              label="Shelf life (days)"
              type="number"
              placeholder="730"
              hint="0–36500. Needs expiry required."
              isDisabled={!methods.watch("expiryRequired")}
            />
            <FormInput
              name="unitOfMeasure"
              label="Unit of measure"
              placeholder="each"
              hint="Base unit — pack conversions and document lines convert through it."
            />
          </div>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Pack conversions</p>
                <p className="text-secondary text-sm">
                  1 box = 12 each — chains resolve to the base unit; purchase/sales lines convert
                  through them (PH2).
                </p>
              </div>
              <Button
                color="secondary"
                size="sm"
                isDisabled={baseCode === ""}
                onPress={addConversion}
              >
                Add conversion
              </Button>
            </div>
            {baseCode === "" && (
              <p className="text-tertiary text-sm">
                Set the base unit of measure first — every chain resolves to it.
              </p>
            )}
            {conversions.map((row, index) => (
              <div key={index} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
                <Input
                  label="Unit"
                  placeholder="box"
                  value={row.unit}
                  onChange={(value) => setConversion(index, "unit", value)}
                />
                <Input
                  label="Factor"
                  type="number"
                  placeholder="12"
                  value={row.factor}
                  onChange={(value) => setConversion(index, "factor", value)}
                />
                <Select
                  aria-label={`Converts to (conversion ${index + 1})`}
                  label="Converts to"
                  placeholder="Choose…"
                  items={parentOptions(index).map((option) => ({ id: option, label: option }))}
                  value={normalizeUoMCode(row.parent)}
                  onChange={(key) => {
                    if (key !== null) setConversion(index, "parent", String(key));
                  }}
                >
                  {(item) => (
                    <Select.Item id={item.id} key={item.id}>
                      {item.label}
                    </Select.Item>
                  )}
                </Select>
                <Button color="tertiary" size="sm" onPress={() => removeConversion(index)}>
                  Remove
                </Button>
              </div>
            ))}
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormSelect
              name="purchaseUoM"
              label="Purchase UoM"
              items={docUoMItems}
              placeholder={baseCode === "" ? "Base unit" : baseCode}
              hint="Default unit on purchase lines (PH2) — base or conversion unit."
            />
            <FormSelect
              name="salesUoM"
              label="Sales UoM"
              items={docUoMItems}
              placeholder={baseCode === "" ? "Base unit" : baseCode}
              hint="Default unit on sales lines (PH2) — base or conversion unit."
            />
          </div>
        </Section>

        {/* -------------------------------------------------------- Media */}
        <Section title="Media" description="Images customers see — cover first.">
          <MediaGallery images={images} onChange={changeImages} onRemove={removeImage} />
        </Section>

        {/* ---------------------------------------------------------- SEO */}
        <Section title="SEO" description="Search-result preview fields (PH4 serves them).">
          <FormInput
            name="seoTitle"
            label="SEO title"
            placeholder="Portable Ultrasound X5 — Acme Medical"
            hint="Up to 100 characters; falls back to the product name."
          />
          <FormTextarea
            name="seoDescription"
            label="SEO description"
            rows={3}
            hint="Up to 300 characters."
          />
        </Section>

        {/* --------------------------------------------- Danger zone/deletion */}
        {targetId !== null && canDelete ? (
          <Section title="Delete product" description="Removes the product and its stored values.">
            <div className="flex items-center justify-between gap-4">
              <p className="text-secondary text-sm">
                Stock and serial references will block deletion once those modules exist (PH2/PH5);
                archived products stay recoverable (PH1-15).
              </p>
              {confirmDelete ? (
                <Button color="tertiary" className="text-error shrink-0" onPress={handleDelete}>
                  Confirm delete
                </Button>
              ) : (
                <Button
                  color="tertiary"
                  className="text-error shrink-0"
                  onPress={() => setConfirmDelete(true)}
                >
                  Delete
                </Button>
              )}
            </div>
          </Section>
        ) : null}

        {/* --------------------------------------------------------- Footer */}
        <Card>
          <div className="flex items-center justify-between gap-3 px-6 py-4">
            <p className="text-tertiary text-sm">
              {targetId === null
                ? "Autosaves as a draft once the name and SKU are valid."
                : "Autosaves as you type — no-op saves record nothing."}
            </p>
            <div className="flex items-center gap-3">
              <span
                className={cx(
                  "text-sm",
                  saveState === "error"
                    ? "text-error"
                    : saveState === "saved"
                      ? "text-tertiary"
                      : "text-primary font-medium",
                )}
                role="status"
              >
                {indicator}
              </span>
              <Button type="submit" color="primary" isLoading={saveState === "saving"}>
                {targetId === null ? "Create product" : "Save changes"}
              </Button>
            </div>
          </div>
        </Card>
      </Form>
      {targetId !== null ? <ProductVendors productId={targetId} canEdit /> : null}
    </div>
  );
}

/** Select input for a dynamic attribute (valuesMap-backed, not zod). */
function FormSelectLike({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <Select
      aria-label={label}
      label={label}
      hint={hint}
      placeholder="Choose…"
      items={options.map((option) => ({ id: option, label: option }))}
      value={value}
      onChange={(key) => {
        if (key !== null) onChange(String(key));
      }}
    >
      {(item) => (
        <Select.Item id={item.id} key={item.id}>
          {item.label}
        </Select.Item>
      )}
    </Select>
  );
}

/* --------------------------------------------------------------- read-only */

/** View-only rendering for catalog.view roles (PH1-02 facts-panel pattern). */
export function ProductFacts({
  product,
  storedValues,
  definitions,
  sets,
  categories,
}: {
  product: Doc<"products">;
  storedValues: Doc<"attributeValues">[];
  definitions: Doc<"attributeDefinitions">[];
  sets: Doc<"attributeSets">[];
  categories: CategoryRow[];
}) {
  const covers = useProductCovers([product._id]);
  const categoryName = new Map(categories.map((row) => [row._id as string, row.name]));
  const setNames = new Set(
    (product.attributeSetIds ?? []).map((id) => sets.find((s) => s._id === id)?.name ?? id),
  );
  const definitionById = new Map(definitions.map((row) => [row._id, row]));
  const trueFlags = (
    [
      ["Serial tracked", product.serialTracked],
      ["Lot tracked", product.lotTracked],
      ["Expiry required", product.expiryRequired],
      ["Warranty eligible", product.warrantyEligible],
      ["Allow backorder", product.allowBackorder],
    ] as const
  )
    .filter(([, on]) => on === true)
    .map(([label]) => label);

  const margin = marginPercent(product.listPrice, product.costPrice);

  // Media (PH1-13): view-only roles see the cover-first gallery too —
  // one batched URL query, alt text is the image's accessible description.
  const imageIds = useMemo(
    () => (product.images ?? []).map((image) => image.fileId),
    [product.images],
  );
  const imageUrlRows = useQuery(api.files.urls, { fileIds: imageIds });

  const facts: { label: string; value: React.ReactNode }[] = [
    { label: "SKU", value: <span className="font-mono text-xs">{product.sku}</span> },
    { label: "Slug", value: <span className="font-mono text-xs">/{product.slug}</span> },
    { label: "Status", value: PRODUCT_STATUS_LABELS[product.status] },
    ...(product.brand ? [{ label: "Brand", value: product.brand }] : []),
    ...(product.barcode
      ? [{ label: "Barcode", value: <span className="font-mono text-xs">{product.barcode}</span> }]
      : []),
    ...(product.listPrice !== undefined
      ? [{ label: "List price", value: String(product.listPrice) }]
      : []),
    // Cost + margin are staff-side only (PH1-10) — the storefront (PH4)
    // projects listPrice alone, so nothing here can leak to customers.
    ...(product.costPrice !== undefined
      ? [{ label: "Cost price", value: String(product.costPrice) }]
      : []),
    ...(margin !== null ? [{ label: "Margin", value: `${margin.toFixed(1)}%` }] : []),
    ...(product.taxCategory
      ? [{ label: "Tax category", value: TAX_CATEGORY_LABELS[product.taxCategory] }]
      : []),
    {
      label: "Categories",
      value:
        product.categoryIds.length > 0
          ? product.categoryIds.map((id) => categoryName.get(id) ?? "—").join(", ")
          : "—",
    },
    ...(setNames.size > 0 ? [{ label: "Attribute sets", value: [...setNames].join(", ") }] : []),
    ...(trueFlags.length > 0 ? [{ label: "Tracking", value: trueFlags.join(", ") }] : []),
    ...(product.warrantyMonths !== undefined
      ? [{ label: "Warranty", value: `${product.warrantyMonths} months` }]
      : []),
    ...(product.shelfLifeDays !== undefined
      ? [{ label: "Shelf life", value: `${product.shelfLifeDays} days` }]
      : []),
    ...(product.unitOfMeasure ? [{ label: "Unit of measure", value: product.unitOfMeasure }] : []),
    ...(product.conversions && product.conversions.length > 0
      ? [
          {
            label: "Conversions",
            value: product.conversions
              .map((row) => `1 ${row.unit} = ${row.factor} ${row.parent}`)
              .join(" · "),
          },
        ]
      : []),
    ...(product.purchaseUoM ? [{ label: "Purchase UoM", value: product.purchaseUoM }] : []),
    ...(product.salesUoM ? [{ label: "Sales UoM", value: product.salesUoM }] : []),
    ...(product.seoTitle ? [{ label: "SEO title", value: product.seoTitle }] : []),
    ...(product.seoDescription
      ? [{ label: "SEO description", value: product.seoDescription }]
      : []),
    ...storedValues.map((row) => {
      const definition = definitionById.get(row.attributeId);
      const value =
        row.valueText ??
        (row.valueNumber !== undefined
          ? `${row.valueNumber}${definition?.unit ? ` ${definition.unit}` : ""}`
          : row.valueDate !== undefined
            ? new Date(row.valueDate).toISOString().slice(0, 10)
            : row.valueBoolean !== undefined
              ? row.valueBoolean
                ? "Yes"
                : "No"
              : "—");
      return { label: definition?.name ?? "Value", value };
    }),
  ];

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={product.name}
        description="View only — an editor role can change this product."
        leading={<ProductCover src={covers.get(product._id)} className="size-16" />}
        actions={
          <Badge color={product.status === "active" ? "brand" : "gray"} size="md">
            {PRODUCT_STATUS_LABELS[product.status]}
          </Badge>
        }
      />
      {product.images && product.images.length > 0 ? (
        <Card>
          <div className="border-tertiary border-b px-6 py-4">
            <h2 className="text-primary text-base font-semibold">Media</h2>
            <p className="text-tertiary text-sm">Cover first — alt text describes each image.</p>
          </div>
          <ul className="grid grid-cols-2 gap-4 p-6 sm:grid-cols-3">
            {product.images.map((image, index) => {
              const url = imageUrlRows?.find((row) => row.fileId === image.fileId)?.url ?? null;
              return (
                <li
                  key={image.fileId}
                  className="bg-primary ring-secondary overflow-hidden rounded-xl ring-1"
                >
                  <div className="bg-secondary relative aspect-square w-full overflow-hidden">
                    {url ? (
                      // Cloudinary delivery URL for the attached file.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={url} alt={image.alt ?? ""} className="size-full object-cover" />
                    ) : (
                      <div className="flex size-full items-center justify-center">
                        <Image01 className="text-fg-tertiary size-8" />
                      </div>
                    )}
                    {index === 0 ? (
                      <span className="bg-primary ring-tertiary text-secondary absolute top-2 left-2 rounded-full px-2 py-0.5 text-xs font-medium shadow-xs ring-1">
                        Cover
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
      <Card>
        <dl className="space-y-3 p-6">
          {facts.map((fact) => (
            <div key={fact.label} className="flex items-start justify-between gap-4">
              <dt className="text-tertiary shrink-0 text-sm">{fact.label}</dt>
              <dd className="text-primary min-w-0 text-right text-sm break-words">{fact.value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      {product.shortDescription || product.longDescription ? (
        <Card>
          <div className="border-tertiary border-b px-6 py-4">
            <h2 className="text-md text-primary font-semibold">Description</h2>
          </div>
          <div className="space-y-3 p-6">
            {product.shortDescription ? (
              <p className="text-secondary text-sm">{product.shortDescription}</p>
            ) : null}
            {product.longDescription ? (
              // Sanitized at write (PH1-07's `sanitizeRichText`) — safe as-is.
              <div
                className="prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: product.longDescription }}
              />
            ) : null}
          </div>
        </Card>
      ) : null}
      <ProductVendors productId={product._id} canEdit={false} />
    </div>
  );
}
