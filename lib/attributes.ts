import type { Doc } from "../convex/_generated/dataModel";

/**
 * Applicable-attribute resolution (PH1-04 → PH1-07) — the ONE ordering rule
 * for "which attribute definitions apply here", kept pure so the Convex side
 * (server: `attributes.forCategory`, `attributes.applicableAttributes` for
 * the product editor and its mutation validation) and the client side (the
 * PH1-07 form, which must render inputs for a NOT-YET-SAVED product — no row
 * exists to ask the server about) can never disagree.
 *
 * Rule (from PH1-04's `forCategory`): a SET applies when it covers at least
 * one of the target's `categoryIds`, OR — the product-level extension —
 * when the target's own `attributeSetIds` picks it. Sets are walked in the
 * given order (callers pass name order: `attributeSets.list` /
 * the `by_name` index), then each set's `attributeIds` in stored order,
 * deduplicated — first occurrence wins, so a definition shared by two
 * applicable sets appears once, where the earlier set put it.
 *
 * `sets` must arrive name-ordered (attributes sort is name, then creation
 * time, via the index). Unknown definition ids (a set row referencing a
 * deleted definition — shouldn't happen; sets validate on write) are
 * skipped rather than crashing the editor.
 */
export function orderApplicableAttributes(
  sets: Doc<"attributeSets">[],
  definitions: Doc<"attributeDefinitions">[],
  target: { categoryIds: string[]; attributeSetIds: string[] },
): Doc<"attributeDefinitions">[] {
  const categories = new Set(target.categoryIds);
  const ownSets = new Set(target.attributeSetIds);
  const byId = new Map(definitions.map((row) => [row._id, row]));
  const seen = new Set<string>();
  const ordered: Doc<"attributeDefinitions">[] = [];

  for (const set of sets) {
    const coversCategory = set.categoryIds.some((id) => categories.has(id));
    if (!coversCategory && !ownSets.has(set._id)) continue;
    for (const definitionId of set.attributeIds) {
      if (seen.has(definitionId)) continue;
      seen.add(definitionId);
      const row = byId.get(definitionId);
      if (row !== undefined) ordered.push(row);
    }
  }
  return ordered;
}
