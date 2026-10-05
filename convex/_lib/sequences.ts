import type {
  DataModelFromSchemaDefinition,
  GenericMutationCtx,
  GenericQueryCtx,
} from "convex/server";
import { ConvexError } from "convex/values";
import type schema from "../schema";

/**
 * Document-number generator (PH0-25): `INV-0007`-style numbers from the
 * `sequences` table. Consume inside the SAME mutation that creates the
 * document — Convex serializes writes per document, so concurrent orders
 * can't receive the same number.
 *
 * The canonical name → prefix list seeds here (PH0-34) and documents the
 * vocabulary later phases consume (`nextSequence(ctx, "invoice")`).
 */

type DataModel = DataModelFromSchemaDefinition<typeof schema>;
type MutationCtx = GenericMutationCtx<DataModel>;
type ReadCtx = GenericQueryCtx<DataModel> | MutationCtx;

/** Canonical document sequences (seeded idempotently by `ensureDefaultSequences`). */
export const DEFAULT_SEQUENCES: { name: string; prefix: string; padding: number }[] = [
  { name: "quote", prefix: "QT-", padding: 4 },
  { name: "salesOrder", prefix: "SO-", padding: 4 },
  { name: "deliveryNote", prefix: "DN-", padding: 4 },
  { name: "invoice", prefix: "INV-", padding: 4 },
  { name: "creditNote", prefix: "CR-", padding: 4 },
  { name: "purchaseOrder", prefix: "PO-", padding: 4 },
  { name: "goodsReceipt", prefix: "GRN-", padding: 4 },
  { name: "payment", prefix: "PAY-", padding: 4 },
  { name: "journal", prefix: "JRNL-", padding: 4 },
  { name: "rma", prefix: "RMA-", padding: 4 },
  { name: "workOrder", prefix: "WO-", padding: 4 },
];

type SequenceDoc = { prefix: string; next: number; padding: number };

/** `INV-` + zero-padded counter. Pure — reused by previews (PH0-30 UI). */
export function formatSequence(sequence: SequenceDoc): string {
  return `${sequence.prefix}${String(sequence.next).padStart(sequence.padding, "0")}`;
}

async function loadSequence(ctx: ReadCtx, name: string) {
  const sequence = await ctx.db
    .query("sequences")
    .withIndex("by_name", (q) => q.eq("name", name))
    .unique();
  if (sequence === null) {
    throw new ConvexError(
      `No document sequence named "${name}" — create it in Settings or run the seed script.`,
    );
  }
  return sequence;
}

/**
 * Consume the next number for `name` and return it formatted ("INV-0001").
 * Bumps `sequences.next` in the caller's transaction: a rolled-back document
 * creation gives the number back, a committed one keeps it forever.
 */
export async function nextSequence(ctx: MutationCtx, name: string): Promise<string> {
  const sequence = await loadSequence(ctx, name);
  const formatted = formatSequence(sequence);
  await ctx.db.patch(sequence._id, { next: sequence.next + 1, updatedAt: Date.now() });
  return formatted;
}

/** The number `nextSequence` would return — without consuming it (previews). */
export async function peekSequence(ctx: ReadCtx, name: string): Promise<string> {
  return formatSequence(await loadSequence(ctx, name));
}

/** Idempotently insert the canonical sequences that don't exist yet. */
export async function ensureDefaultSequences(ctx: MutationCtx): Promise<void> {
  for (const entry of DEFAULT_SEQUENCES) {
    const existing = await ctx.db
      .query("sequences")
      .withIndex("by_name", (q) => q.eq("name", entry.name))
      .unique();
    if (existing === null) {
      await ctx.db.insert("sequences", { ...entry, next: 1, updatedAt: Date.now() });
    }
  }
}
