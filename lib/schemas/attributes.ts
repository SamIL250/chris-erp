import { z } from "zod";

/**
 * Attribute editor validation (PH1-04) — the client mirror of the rules in
 * `convex/catalog/attributes.ts` / `convex/catalog/attributeSets.ts`; the
 * server stays the enforcement point (its ConvexErrors surface through
 * `toUserMessage` in the form alert).
 *
 * The definition form keeps `unit` and `optionsText` (one option per line)
 * as plain strings and only SENDS what the type allows — mirrors the
 * server's shape rules without cross-field refines.
 */

/** The six attribute types — shared by the form's type picker and zod. */
export const ATTRIBUTE_TYPES = [
  "text",
  "number",
  "select",
  "multi_select",
  "boolean",
  "date",
] as const;

export const isSelectType = (type: string): boolean => type === "select" || type === "multi_select";

/** Short labels: badges in lists, option labels in the type picker. */
export const ATTRIBUTE_TYPE_LABELS: Record<(typeof ATTRIBUTE_TYPES)[number], string> = {
  text: "Text",
  number: "Number",
  select: "Select",
  multi_select: "Multi-select",
  boolean: "Boolean",
  date: "Date",
};

export const definitionSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(100, "Name must be 100 characters or fewer."),
  type: z.enum(ATTRIBUTE_TYPES),
  unit: z.string().max(50, "Unit must be 50 characters or fewer."),
  optionsText: z.string(),
});

export type DefinitionFormValues = z.output<typeof definitionSchema>;

export const attributeSetSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(100, "Name must be 100 characters or fewer."),
});

export type AttributeSetFormValues = z.output<typeof attributeSetSchema>;

/** Parse the one-per-line options textarea: trimmed, blanks dropped. */
export function parseOptions(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
