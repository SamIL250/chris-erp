import type { DataModelFromSchemaDefinition, GenericMutationCtx } from "convex/server";
import type { GenericId } from "convex/values";
import type schema from "../schema";

type DataModel = DataModelFromSchemaDefinition<typeof schema>;
type MutationCtx = GenericMutationCtx<DataModel>;

/**
 * Insert an in-app notification (PH0-28). Call it from inside a mutation's
 * handler: mutations are transactional, so if the handler throws nothing is
 * notified, and the bell (which reads `notifications`) updates reactively.
 *
 * Future events wire up the same way — order shipped, invoice posted, low
 * stock, warranty expiring — one `notify()` call at the end of the mutation.
 *
 * Read-state changes (`markRead`/`markAllRead`) are deliberately *not*
 * audited: they're interaction state, not business events.
 */
export async function notify(
  ctx: MutationCtx,
  args: {
    userId: GenericId<"users">;
    title: string;
    body?: string;
    /** Optional tone — the bell can colour the icon by it later. */
    kind?: "info" | "success" | "warning";
    /** Deep link to the relevant page. */
    href?: string;
  },
): Promise<void> {
  await ctx.db.insert("notifications", { ...args, createdAt: Date.now() });
}
