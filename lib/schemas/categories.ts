import { z } from "zod";

/**
 * Category editor validation (PH1-02) — the client mirror of the rules in
 * `convex/catalog/categories.ts`; the server stays the enforcement point
 * (its ConvexErrors surface through `toUserMessage` in the form alert).
 *
 * `slug` is always a string in the form: `""` means "derive from the name"
 * on create (or "re-derive" on save) — the backend also accepts a missing
 * slug as derive, but sending the explicit value keeps the intent visible.
 * `parentId` is `""` for the top level (FormSelect stores item ids as
 * strings; cast to an `Id<"categories">` at submit).
 */
export const categorySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(100, "Name must be 100 characters or fewer."),
  slug: z.string().max(60, "Slug must be 60 characters or fewer."),
  parentId: z.string(),
  description: z.string().max(5000, "Description must be 5000 characters or fewer."),
  seoTitle: z.string().max(100, "SEO title must be 100 characters or fewer."),
  seoDescription: z.string().max(300, "SEO description must be 300 characters or fewer."),
  visible: z.boolean(),
});

export type CategoryFormValues = z.output<typeof categorySchema>;
