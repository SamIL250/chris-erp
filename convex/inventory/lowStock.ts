import { ConvexError } from "convex/values";
import { isLowStock, reorderPointFor, type ReorderPointRef } from "../../lib/reorder";
import { stockBalance } from "../../lib/stock";
import { appendAudit } from "../_lib/audit";
import { notify } from "../_lib/notifications";
import { hasPermission, roleKeysForUsers } from "../_lib/permissions";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internalMutation } from "../_generated/server";
import { BALANCE_CAP } from "./stock";

/**
 * Daily low-stock scan (PH1-24). An internal mutation: no signed-in
 * user, so the audit actor is "system". A slice notifies once when
 * available falls to its reorder point, and again only after it has
 * risen above that point and fallen once more.
 */

/** How many new notices one run will send. The rest wait for tomorrow. */
const NOTIFY_CAP = 50;

type Slice = {
  productId: Id<"products">;
  variantId?: Id<"variants">;
  warehouseId: Id<"warehouses">;
  available: number;
};

function sameSlice(
  notice: { productId: Id<"products">; variantId?: Id<"variants">; warehouseId: Id<"warehouses"> },
  slice: Slice,
): boolean {
  return (
    notice.productId === slice.productId &&
    notice.warehouseId === slice.warehouseId &&
    notice.variantId === slice.variantId
  );
}

function slicesFrom(
  movements: Doc<"stockMovements">[],
  points: ReorderPointRef[],
  activeWarehouses: Id<"warehouses">[],
): Slice[] {
  const groups = new Map<string, Doc<"stockMovements">[]>();
  for (const row of movements) {
    const key = `${row.productId}:${row.variantId ?? ""}:${row.warehouseId}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [row]);
    else group.push(row);
  }

  const slices: Slice[] = [];
  const covered = new Set<string>();
  const active = new Set(activeWarehouses.map((id) => id as string));
  for (const lines of groups.values()) {
    const first = lines[0];
    if (first === undefined || !active.has(first.warehouseId as string)) continue;
    slices.push({
      productId: first.productId,
      variantId: first.variantId,
      warehouseId: first.warehouseId,
      available: stockBalance(lines).available,
    });
    covered.add(`${first.productId}:${first.warehouseId}`);
  }

  const products = new Set(points.map((point) => point.productId));
  for (const productId of products) {
    const specific = points.flatMap((point) =>
      point.productId === productId &&
      point.warehouseId !== undefined &&
      active.has(point.warehouseId)
        ? [point.warehouseId]
        : [],
    );
    const general = points.some(
      (point) => point.productId === productId && point.warehouseId === undefined,
    );
    const warehouses = general ? [...active] : specific;
    for (const warehouseId of warehouses) {
      if (covered.has(`${productId}:${warehouseId}`)) continue;
      slices.push({
        productId: productId as Id<"products">,
        warehouseId: warehouseId as Id<"warehouses">,
        available: 0,
      });
    }
  }
  return slices;
}

export const scan = internalMutation({
  args: {},
  handler: async (ctx: MutationCtx) => {
    const movements = await ctx.db.query("stockMovements").take(BALANCE_CAP + 1);
    if (movements.length > BALANCE_CAP) {
      throw new ConvexError("Too many stock movements to scan for low stock.");
    }
    const pointRows = await ctx.db.query("reorderPoints").collect();
    const points: ReorderPointRef[] = pointRows.map((row) => ({
      productId: row.productId as string,
      warehouseId: row.warehouseId as string | undefined,
      qty: row.qty,
    }));
    const warehouses = await ctx.db.query("warehouses").collect();
    const active = warehouses.filter((row) => row.active).map((row) => row._id);
    const slices = slicesFrom(movements, points, active);
    const open = await ctx.db
      .query("lowStockNotices")
      .withIndex("by_open", (q) => q.eq("open", true))
      .collect();

    const opening: { slice: Slice; point: number }[] = [];
    const closing: Doc<"lowStockNotices">[] = [];
    for (const slice of slices) {
      const point = reorderPointFor(points, slice.productId, slice.warehouseId);
      const notice = open.find((row) => sameSlice(row, slice));
      if (isLowStock(slice.available, point) && point !== undefined) {
        if (notice === undefined) opening.push({ slice, point });
      } else if (notice !== undefined) {
        closing.push(notice);
      }
    }

    const fresh = opening.slice(0, NOTIFY_CAP);
    if (fresh.length === 0 && closing.length === 0) return null;

    const users = (await ctx.db.query("users").collect()).filter(
      (user) => user.status === "active",
    );
    const keys = await roleKeysForUsers(
      ctx,
      users.map((user) => user._id),
    );
    const recipients = users.filter((user) =>
      hasPermission(keys.get(user._id as string) ?? [], "inventory", "edit"),
    );

    const opened: {
      productId: Id<"products">;
      warehouseId: Id<"warehouses">;
      variantId?: Id<"variants">;
      available: number;
      point: number;
    }[] = [];
    if (recipients.length > 0) {
      for (const { slice, point } of fresh) {
        const product = await ctx.db.get(slice.productId);
        const variant = slice.variantId !== undefined ? await ctx.db.get(slice.variantId) : null;
        const warehouse = await ctx.db.get(slice.warehouseId);
        const name = product?.name ?? "A product";
        const sku = variant?.sku ?? product?.sku ?? "—";
        const code = warehouse?.code ?? "—";
        const href =
          slice.variantId === undefined
            ? `/inventory/stock/${slice.productId}?warehouse=${slice.warehouseId}`
            : `/inventory/stock/${slice.productId}?warehouse=${slice.warehouseId}&variant=${slice.variantId}`;
        await ctx.db.insert("lowStockNotices", {
          productId: slice.productId,
          ...(slice.variantId !== undefined ? { variantId: slice.variantId } : {}),
          warehouseId: slice.warehouseId,
          open: true,
          openedAt: Date.now(),
        });
        for (const user of recipients) {
          await notify(ctx, {
            userId: user._id,
            title: `Low stock: ${name}`,
            body: `${sku} at ${code} has ${slice.available} available. Reorder at ${point}.`,
            kind: "warning",
            href,
          });
        }
        opened.push({
          productId: slice.productId,
          warehouseId: slice.warehouseId,
          variantId: slice.variantId,
          available: slice.available,
          point,
        });
      }
    }

    const closed: Id<"lowStockNotices">[] = [];
    for (const notice of closing) {
      await ctx.db.patch(notice._id, { open: false, closedAt: Date.now() });
      closed.push(notice._id);
    }

    if (opened.length === 0 && closed.length === 0) return null;

    await appendAudit(ctx, {
      entity: "lowStockNotices",
      action: "scan",
      entityId: "daily",
      after: { opened, closed },
    });
    return { opened: opened.length, closed: closed.length };
  },
});
