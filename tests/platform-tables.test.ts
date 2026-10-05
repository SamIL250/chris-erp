import { describe, expect, test } from "vitest";
import { setup } from "./setup";

/**
 * Platform-table schema sanity (PH0-24): every foundation table accepts a
 * minimal valid document and its declared indexes are queryable. Guards the
 * validators/indexes the later phases (PH0-25…33) build on.
 */

describe("platform tables (PH0-24)", () => {
  test("settings / sequences / currencies / exchangeRates write and index", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("settings", { key: "featureFlags", value: { beta: true }, updatedAt: 1 });
      const inv = await ctx.db.insert("sequences", {
        name: "invoice",
        prefix: "INV-",
        next: 1,
        padding: 4,
        updatedAt: 1,
      });
      await ctx.db.insert("currencies", {
        code: "USD",
        name: "US Dollar",
        symbol: "$",
        decimalPlaces: 2,
        active: true,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("exchangeRates", {
        baseCurrency: "USD",
        quoteCurrency: "EUR",
        rate: 0.92,
        source: "manual",
        effectiveAt: 1,
        createdAt: 1,
      });

      const byKey = await ctx.db
        .query("settings")
        .withIndex("by_key", (q) => q.eq("key", "featureFlags"))
        .unique();
      expect(byKey?.value).toEqual({ beta: true });

      const byName = await ctx.db
        .query("sequences")
        .withIndex("by_name", (q) => q.eq("name", "invoice"))
        .unique();
      expect(byName?._id).toBe(inv);

      const byCode = await ctx.db
        .query("currencies")
        .withIndex("by_code", (q) => q.eq("code", "USD"))
        .unique();
      expect(byCode?.active).toBe(true);

      const byPair = await ctx.db
        .query("exchangeRates")
        .withIndex("by_pair", (q) => q.eq("baseCurrency", "USD").eq("quoteCurrency", "EUR"))
        .unique();
      expect(byPair?.rate).toBe(0.92);
    });
  });

  test("taxRates / taxGroups write and index", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      const vat = await ctx.db.insert("taxRates", {
        name: "VAT 20%",
        rateBps: 2000,
        inclusive: false,
        active: true,
        createdAt: 1,
        updatedAt: 1,
      });
      const reduced = await ctx.db.insert("taxRates", {
        name: "VAT 5%",
        rateBps: 500,
        inclusive: false,
        active: true,
        createdAt: 1,
        updatedAt: 1,
      });
      const group = await ctx.db.insert("taxGroups", {
        name: "Standard",
        isDefault: true,
        rates: { standard: vat, reduced },
        active: true,
        createdAt: 1,
        updatedAt: 1,
      });

      const activeGroups = await ctx.db
        .query("taxGroups")
        .withIndex("by_active", (q) => q.eq("active", true))
        .collect();
      expect(activeGroups.map((g) => g._id)).toEqual([group]);

      const activeRates = await ctx.db
        .query("taxRates")
        .withIndex("by_active", (q) => q.eq("active", true))
        .collect();
      expect(activeRates).toHaveLength(2);
      expect(activeRates.some((r) => r.rateBps === 2000)).toBe(true);
    });
  });

  test("auditLog is append-only shaped and queryable by entity/time", async () => {
    const t = setup();
    const actorId = await t.run((ctx) =>
      ctx.db.insert("users", {
        email: "auditor@example.com",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("auditLog", {
        actorId,
        actorLabel: "auditor@example.com",
        action: "update",
        entity: "users",
        entityId: "k1",
        before: { name: "Old" },
        after: { name: "New" },
        createdAt: 10,
      });
      await ctx.db.insert("auditLog", {
        action: "create",
        entity: "users",
        entityId: "k2",
        after: { name: "Fresh" },
        createdAt: 20,
      });

      const forEntity = await ctx.db
        .query("auditLog")
        .withIndex("by_entity", (q) => q.eq("entity", "users").eq("entityId", "k1"))
        .unique();
      expect(forEntity?.before).toEqual({ name: "Old" });

      const recent = await ctx.db
        .query("auditLog")
        .withIndex("by_time", (q) => q.gte("createdAt", 15))
        .collect();
      expect(recent).toHaveLength(1);
      expect(recent[0]?.actorId).toBeUndefined(); // system action
    });
  });

  test("notifications index by user and support unread filtering", async () => {
    const t = setup();
    const userId = await t.run((ctx) =>
      ctx.db.insert("users", {
        email: "notified@example.com",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("notifications", {
        userId,
        title: "Order #42 shipped",
        href: "/sales/orders/42",
        createdAt: 1,
      });
      await ctx.db.insert("notifications", {
        userId,
        title: "Low stock: Monitors",
        kind: "warning",
        readAt: 2,
        createdAt: 2,
      });

      const mine = await ctx.db
        .query("notifications")
        .withIndex("by_user_time", (q) => q.eq("userId", userId))
        .order("desc")
        .collect();
      expect(mine.map((n) => n.title)).toEqual(["Low stock: Monitors", "Order #42 shipped"]);

      const unread = mine.filter((n) => n.readAt === undefined);
      expect(unread.map((n) => n.title)).toEqual(["Order #42 shipped"]);
    });
  });

  test("files register storage uploads with kind + owner indexes", async () => {
    const t = setup();
    const { storageId, uploaderId } = await t.run(async (ctx) => {
      const uploaderId = await ctx.db.insert("users", {
        email: "uploader@example.com",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const storageId = await ctx.storage.store(new Blob(["hi"]));
      await ctx.db.insert("files", {
        storageId,
        name: "logo.png",
        mimeType: "image/png",
        size: 2,
        kind: "logo",
        uploadedBy: uploaderId,
        createdAt: 1,
      });
      return { storageId, uploaderId };
    });

    await t.run(async (ctx) => {
      const logos = await ctx.db
        .query("files")
        .withIndex("by_kind", (q) => q.eq("kind", "logo"))
        .unique();
      expect(logos?.storageId).toBe(storageId);
      const byUser = await ctx.db
        .query("files")
        .withIndex("by_uploadedBy", (q) => q.eq("uploadedBy", uploaderId))
        .collect();
      expect(byUser).toHaveLength(1);
      // Stored bytes are retrievable via the id the registry points at.
      const blob = await ctx.storage.get(storageId);
      expect(await blob?.text()).toBe("hi");
    });
  });
});
