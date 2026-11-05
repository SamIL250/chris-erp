import { z } from "zod";
import { MAX_PRICE } from "../pricing";
import { validateSku } from "../sku";
import { TRACKING_RULES } from "../tracking";
import { normalizeUoMCode, uomCodeError } from "../uom";

/**
 * Product editor validation (PH1-07) — the client mirror of the rules in
 * `convex/catalog/products.ts`; the server stays the enforcement point (its
 * ConvexErrors surface through `toUserMessage` in the form alert).
 *
 * SKU runs through the SAME `validateSku` the mutation uses, so a format
 * message is byte-identical on both sides — and, like the server, it never
 * rewrites a typed SKU (only the slugs derive, from the name). Counts and
 * lengths reuse the server's exact wording where it's cheap.
 *
 * `categoryIds` / `attributeSetIds` / attribute VALUES / UoM CONVERSIONS
 * live outside this schema (checkbox + dynamic-field state, same as the
 * PH1-04 set panel) — they're merged into the mutation payload by the
 * form's `buildArgs`, which runs the shared `lib/uom` chain/membership
 * rules there (cross-field checks need the conversion rows, which zod
 * doesn't hold). The three UoM CODE fields validate their format here.
 */

export const PRODUCT_STATUSES = ["draft", "active", "archived"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  draft: "Draft",
  active: "Active",
  archived: "Archived",
};

/** The PH0-24 taxGroups keys plus the category-level "no rate" option. */
export const TAX_CATEGORIES = ["standard", "reduced", "zero", "exempt"] as const;
export type TaxCategory = (typeof TAX_CATEGORIES)[number];

export const TAX_CATEGORY_LABELS: Record<TaxCategory, string> = {
  standard: "Standard rate",
  reduced: "Reduced rate",
  zero: "Zero rate",
  exempt: "Exempt",
};

/** Whole-number counts with the server's exact message ("" = unset). */
const countField = (max: number, label: string) =>
  z
    .string()
    .refine(
      (value) => value === "" || (/^\d+$/.test(value) && Number(value) <= max),
      `${label} must be a whole number between 0 and ${max}.`,
    );

/**
 * Prices (PH1-10): "" (unset) or a non-negative amount with up to 2
 * decimals. The server enforces the same rules with exact wording
 * (`normalizePrice` in convex/catalog/products.ts) — this gate just keeps
 * invalid drafts from firing a round-trip.
 */
const priceField = (label: string) =>
  z
    .string()
    .refine(
      (value) => value === "" || (/^\d+(\.\d{1,2})?$/.test(value) && Number(value) <= MAX_PRICE),
      `${label} must be a non-negative amount with up to 2 decimals.`,
    );

/**
 * UoM code (PH1-11): "" (unset) or a normalized `lib/uom` code — the SAME
 * normalization + `uomCodeError` wording the mutation throws, so "BOX "
 * passes here, saves as "box", and the message on a bad value matches the
 * server's verbatim. Chain/membership rules (conversions, doc-level UoM
 * reachability) run in `buildProductArgs`, which sees both code fields and
 * the conversion rows.
 */
const uoMField = (label: string) =>
  z.string().superRefine((value, ctx) => {
    if (value.trim() === "") return;
    const error = uomCodeError(normalizeUoMCode(value), label);
    if (error !== null) ctx.addIssue({ code: "custom", message: error });
  });

export const productSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Name is required.")
      .max(100, "Product name must be between 1 and 100 characters."),
    slug: z.string().max(60, "Slug must be 60 characters or fewer."),
    sku: z.string().superRefine((raw, ctx) => {
      const { error } = validateSku(raw);
      if (error !== null) ctx.addIssue({ code: "custom", message: error });
    }),
    barcode: z.string().max(64, "Barcode must be 64 characters or fewer."),
    brand: z.string().max(100, "Brand must be 100 characters or fewer."),
    listPrice: priceField("List price"),
    costPrice: priceField("Cost price"),
    shortDescription: z.string().max(300, "Short description must be 300 characters or fewer."),
    longDescription: z
      .string()
      .max(100_000, "Long description must be 100000 characters or fewer."),
    status: z.enum(PRODUCT_STATUSES),
    taxCategory: z.union([z.literal(""), z.enum(TAX_CATEGORIES)]),
    serialTracked: z.boolean(),
    lotTracked: z.boolean(),
    expiryRequired: z.boolean(),
    warrantyEligible: z.boolean(),
    allowBackorder: z.boolean(),
    warrantyMonths: countField(1200, "Warranty months"),
    shelfLifeDays: countField(36_500, "Shelf life days"),
    unitOfMeasure: uoMField("Unit of measure"),
    purchaseUoM: uoMField("Purchase UoM"),
    salesUoM: uoMField("Sales UoM"),
    seoTitle: z.string().max(100, "SEO title must be 100 characters or fewer."),
    seoDescription: z.string().max(300, "SEO description must be 300 characters or fewer."),
  })
  .superRefine((values, ctx) => {
    // PH1-12 numeric couplings (lib/tracking rules 3–4), attached to the
    // field that renders them — both are FormInput-wired, so the message
    // lands red under its own control. The boolean pairs (serial ⊥ lot,
    // expiry ⇒ lot) stay server-side on purpose: checkbox state has no
    // wired error path here, and a pathless issue would block autosave
    // SILENTLY. The UI makes those pairs unreachable anyway (mutual disable
    // + dependent clears), and the mutation's verbatim error reaches the
    // save alert for whatever an API caller forces. 0 = unset, same as the
    // server's readers (`months > 0` checks).
    const months = values.warrantyMonths === "" ? undefined : Number(values.warrantyMonths);
    if (months !== undefined && months > 0 && !values.warrantyEligible) {
      ctx.addIssue({
        code: "custom",
        path: ["warrantyMonths"],
        message: TRACKING_RULES.warrantyMonthsNeedEligible,
      });
    }
    const shelf = values.shelfLifeDays === "" ? undefined : Number(values.shelfLifeDays);
    if (shelf !== undefined && shelf > 0 && !values.expiryRequired) {
      ctx.addIssue({
        code: "custom",
        path: ["shelfLifeDays"],
        message: TRACKING_RULES.shelfLifeNeedsExpiry,
      });
    }
  });

export type ProductFormValues = z.output<typeof productSchema>;

/** Default form state for a create (blank) or existing product row. */
export function productDefaults(
  product: {
    name: string;
    slug: string;
    sku: string;
    barcode?: string;
    brand?: string;
    listPrice?: number;
    costPrice?: number;
    shortDescription?: string;
    longDescription?: string;
    status: ProductStatus;
    taxCategory?: TaxCategory;
    serialTracked?: boolean;
    lotTracked?: boolean;
    expiryRequired?: boolean;
    warrantyEligible?: boolean;
    allowBackorder?: boolean;
    warrantyMonths?: number;
    shelfLifeDays?: number;
    unitOfMeasure?: string;
    purchaseUoM?: string;
    salesUoM?: string;
    seoTitle?: string;
    seoDescription?: string;
  } | null,
): ProductFormValues {
  return {
    name: product?.name ?? "",
    slug: product?.slug ?? "",
    sku: product?.sku ?? "",
    barcode: product?.barcode ?? "",
    brand: product?.brand ?? "",
    listPrice: product?.listPrice !== undefined ? String(product.listPrice) : "",
    costPrice: product?.costPrice !== undefined ? String(product.costPrice) : "",
    shortDescription: product?.shortDescription ?? "",
    longDescription: product?.longDescription ?? "",
    status: product?.status ?? "draft",
    taxCategory: product?.taxCategory ?? "",
    serialTracked: product?.serialTracked ?? false,
    lotTracked: product?.lotTracked ?? false,
    expiryRequired: product?.expiryRequired ?? false,
    warrantyEligible: product?.warrantyEligible ?? false,
    allowBackorder: product?.allowBackorder ?? false,
    warrantyMonths: product?.warrantyMonths !== undefined ? String(product.warrantyMonths) : "",
    shelfLifeDays: product?.shelfLifeDays !== undefined ? String(product.shelfLifeDays) : "",
    unitOfMeasure: product?.unitOfMeasure ?? "",
    purchaseUoM: product?.purchaseUoM ?? "",
    salesUoM: product?.salesUoM ?? "",
    seoTitle: product?.seoTitle ?? "",
    seoDescription: product?.seoDescription ?? "",
  };
}

/** Date-only inputs ↔ the schema's epoch-ms `valueDate` column. */
export function dateToInput(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

export function inputToDate(value: string): number {
  return Date.parse(`${value}T00:00:00.000Z`);
}
