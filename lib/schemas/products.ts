import { z } from "zod";
import { MAX_PRICE } from "../pricing";
import { validateSku } from "../sku";

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
 * `categoryIds` / `attributeSetIds` / attribute VALUES live outside this
 * schema (checkbox + dynamic-field state, same as the PH1-04 set panel) —
 * they're merged into the mutation payload by the form's `buildArgs`.
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

export const productSchema = z.object({
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
  longDescription: z.string().max(100_000, "Long description must be 100000 characters or fewer."),
  status: z.enum(PRODUCT_STATUSES),
  taxCategory: z.union([z.literal(""), z.enum(TAX_CATEGORIES)]),
  serialTracked: z.boolean(),
  lotTracked: z.boolean(),
  expiryRequired: z.boolean(),
  warrantyEligible: z.boolean(),
  allowBackorder: z.boolean(),
  warrantyMonths: countField(1200, "Warranty months"),
  shelfLifeDays: countField(36_500, "Shelf life days"),
  unitOfMeasure: z.string().max(50, "Unit of measure must be 50 characters or fewer."),
  seoTitle: z.string().max(100, "SEO title must be 100 characters or fewer."),
  seoDescription: z.string().max(300, "SEO description must be 300 characters or fewer."),
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
