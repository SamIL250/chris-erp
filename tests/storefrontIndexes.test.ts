import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { syncProductCategoryRows } from "../convex/_lib/productCategories";
import { setup } from "./setup";

/**
 * Storefront-ready indexes (PH1-05): the three read paths the Phase 4
 * storefront resolves against, proven here with real index scans
 * (convex-test runs the actual query engine):
 *
 * - `categories.urlPath` + `by_url_path` — one indexed hit per URL, prefix
 *   range per subtree; stays fresh through rename/reparent and heals rows
 *   that predate the field.
 * - `productCategories` join + `by_category` — "products in this
 *   category" (Convex indexes an array field as ONE whole-array value, so
 *   `products.categoryIds` itself can't serve contains-reads; the join
 *   mirrors it and is reconciled by seed / PH1-07's product mutations).
 * - `attributeValues` + typed `by_attribute_*` indexes — the faceted-filter
 *   substrate (research §4.7 P0) PH1-07's editor starts populating; values
 *   have no exported reader yet, so the scans live here.
 *
 * Auth identity: `getAuthUserId` takes the part of `subject` before `|`.
 */

type T = ReturnType<typeof setup>;
type Authed = ReturnType<T["withIdentity"]>;

async function seedUser(t: T, email: string) {
  return await t.run((ctx) =>
    ctx.db.insert("users", {
      email,
      status: "active" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}

async function grant(t: T, userId: Id<"users">, roleKey: string) {
  await t.run(async (ctx) => {
    const existing = await ctx.db
      .query("roles")
      .withIndex("by_key", (q) => q.eq("key", roleKey))
      .unique();
    const roleId =
      existing !== null
        ? existing._id
        : await ctx.db.insert("roles", { key: roleKey, name: roleKey, createdAt: Date.now() });
    await ctx.db.insert("userRoles", { userId, roleId, createdAt: Date.now() });
  });
}

async function ownerTools(t: T) {
  const owner = await seedUser(t, "owner@example.com");
  await grant(t, owner, "owner");
  return t.withIdentity({ subject: `${owner}|session-1` });
}

/** slug → urlPath from the admin list (which spreads the stored field). */
async function urlPaths(as: Authed): Promise<Record<string, string>> {
  const rows = await as.query(api.catalog.categories.list, {});
  return Object.fromEntries(rows.map((row) => [row.slug, row.urlPath ?? ""])); // "" fails the expected paths loudly
}

describe("categories.urlPath / by_url_path (PH1-05)", () => {
  test("materializes on create; exact lookup + prefix subtree scan", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const alpha = await as.mutation(api.catalog.categories.create, {
      name: "Alpha",
      visible: true,
    });
    const beta = await as.mutation(api.catalog.categories.create, {
      name: "Beta",
      parentId: alpha.id,
      visible: true,
    });
    const gamma = await as.mutation(api.catalog.categories.create, {
      name: "Gamma",
      parentId: beta.id,
      visible: true,
    });

    expect(await urlPaths(as)).toEqual({
      alpha: "/alpha/",
      beta: "/alpha/beta/",
      gamma: "/alpha/beta/gamma/",
    });

    const resolved = await t.run((ctx) =>
      ctx.db
        .query("categories")
        .withIndex("by_url_path", (q) => q.eq("urlPath", "/alpha/beta/"))
        .unique(),
    );
    expect(resolved?._id).toBe(beta.id);

    const subtree = await t.run((ctx) =>
      ctx.db
        .query("categories")
        .withIndex("by_url_path", (q) =>
          // "/alpha/" prefix: trailing slash keeps sibling "/alpha-x/" out.
          q.gte("urlPath", "/alpha/").lt("urlPath", "/alpha0"),
        )
        .collect(),
    );
    expect(subtree.map((row) => row._id)).toEqual([alpha.id, beta.id, gamma.id]);
  });

  test("renaming a root rewrites every descendant; old URLs stop resolving", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const alpha = await as.mutation(api.catalog.categories.create, {
      name: "Alpha",
      visible: true,
    });
    const beta = await as.mutation(api.catalog.categories.create, {
      name: "Beta",
      parentId: alpha.id,
      visible: true,
    });
    await as.mutation(api.catalog.categories.create, {
      name: "Gamma",
      parentId: beta.id,
      visible: true,
    });

    // "" → re-derive the slug from the new name (PH1-01 rule).
    await as.mutation(api.catalog.categories.update, {
      id: alpha.id,
      name: "Omega",
      slug: "",
      visible: true,
    });

    expect(await urlPaths(as)).toEqual({
      omega: "/omega/",
      beta: "/omega/beta/",
      gamma: "/omega/beta/gamma/",
    });
    const stale = await t.run((ctx) =>
      ctx.db
        .query("categories")
        .withIndex("by_url_path", (q) => q.eq("urlPath", "/alpha/"))
        .unique(),
    );
    expect(stale).toBeNull();
    const fresh = await t.run((ctx) =>
      ctx.db
        .query("categories")
        .withIndex("by_url_path", (q) => q.eq("urlPath", "/omega/beta/"))
        .unique(),
    );
    expect(fresh?._id).toBe(beta.id);
  });

  test("reparenting moves the subtree's paths; other roots untouched", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const alpha = await as.mutation(api.catalog.categories.create, {
      name: "Alpha",
      visible: true,
    });
    const beta = await as.mutation(api.catalog.categories.create, {
      name: "Beta",
      parentId: alpha.id,
      visible: true,
    });
    const xenon = await as.mutation(api.catalog.categories.create, {
      name: "Xenon",
      visible: true,
    });

    await as.mutation(api.catalog.categories.move, {
      id: beta.id,
      newParentId: xenon.id,
      position: 0,
    });

    expect(await urlPaths(as)).toEqual({
      alpha: "/alpha/",
      xenon: "/xenon/",
      beta: "/xenon/beta/",
    });
    const subtree = await t.run((ctx) =>
      ctx.db
        .query("categories")
        .withIndex("by_url_path", (q) => q.gte("urlPath", "/xenon/").lt("urlPath", "/xenon0"))
        .collect(),
    );
    expect(subtree.map((row) => row._id).sort()).toEqual([beta.id, xenon.id].sort());
  });

  test("a row missing urlPath (pre-PH1-05) heals on the next write", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const legacy = await as.mutation(api.catalog.categories.create, {
      name: "Legacy",
      visible: true,
    });
    // Simulate a row from before PH1-05.
    await t.run((ctx) => ctx.db.patch(legacy.id, { urlPath: undefined }));
    const before = await t.run((ctx) =>
      ctx.db
        .query("categories")
        .withIndex("by_url_path", (q) => q.eq("urlPath", "/legacy/"))
        .unique(),
    );
    expect(before).toBeNull();

    await as.mutation(api.catalog.categories.create, { name: "Fresh", visible: true });

    const healed = await t.run((ctx) =>
      ctx.db
        .query("categories")
        .withIndex("by_url_path", (q) => q.eq("urlPath", "/legacy/"))
        .unique(),
    );
    expect(healed?._id).toBe(legacy.id);
  });
});

describe("productCategories join / by_category (PH1-05)", () => {
  test("sync mirrors categoryIds; by_category finds multi-category products", async () => {
    const t = setup();
    const { catX, catY, catZ, p1, p2, p3 } = await t.run(async (ctx) => {
      const base = { createdAt: 1, updatedAt: 1 };
      const catX = await ctx.db.insert("categories", {
        name: "X",
        slug: "x",
        visible: true,
        position: 0,
        ...base,
      });
      const catY = await ctx.db.insert("categories", {
        name: "Y",
        slug: "y",
        visible: true,
        position: 1,
        ...base,
      });
      const catZ = await ctx.db.insert("categories", {
        name: "Z",
        slug: "z",
        visible: true,
        position: 2,
        ...base,
      });
      const product = (name: string, categoryIds: Id<"categories">[]) =>
        ctx.db.insert("products", {
          name,
          slug: name.toLowerCase(),
          sku: name.toUpperCase(),
          status: "active" as const,
          categoryIds,
          createdAt: 1,
          updatedAt: 1,
        });
      const p1 = await product("P1", [catX, catY]); // multi-category
      const p2 = await product("P2", [catY]);
      const p3 = await product("P3", []); // uncategorized: no join rows
      return { catX, catY, catZ, p1, p2, p3 };
    });

    // Reconcile every product (what seed does and PH1-07's editor must do
    // after each categoryIds write) — then a second pass writes nothing.
    const counts = await t.run(async (ctx) => ({
      p1: await syncProductCategoryRows(ctx, p1),
      p2: await syncProductCategoryRows(ctx, p2),
      p3: await syncProductCategoryRows(ctx, p3),
      again: await syncProductCategoryRows(ctx, p1),
    }));
    expect(counts).toEqual({ p1: 2, p2: 1, p3: 0, again: 0 });

    const productsIn = async (categoryId: Id<"categories">) =>
      (
        await t.run((ctx) =>
          ctx.db
            .query("productCategories")
            .withIndex("by_category", (q) => q.eq("categoryId", categoryId))
            .collect(),
        )
      )
        .map((row) => row.productId)
        .sort();

    expect(await productsIn(catX)).toEqual([p1]);
    expect(await productsIn(catY)).toEqual([p1, p2].sort());
    expect(await productsIn(catZ)).toEqual([]); // nothing joined yet

    // categoryIds change → sync drops the orphan and adds the new pair.
    const delta = await t.run(async (ctx) => {
      await ctx.db.patch(p1, { categoryIds: [catY, catZ] });
      return await syncProductCategoryRows(ctx, p1);
    });
    expect(delta).toBe(1); // one insert (Z), one delete
    expect(await productsIn(catX)).toEqual([]);
    expect(await productsIn(catZ)).toEqual([p1]);

    // by_product answers the reverse direction (and drives the sync).
    const p1Rows = await t.run((ctx) =>
      ctx.db
        .query("productCategories")
        .withIndex("by_product", (q) => q.eq("productId", p1))
        .collect(),
    );
    expect(p1Rows.map((row) => row.categoryId).sort()).toEqual([catY, catZ].sort());
    expect(p3).toBeDefined(); // empty categoryIds → zero join rows by design
  });
});

describe("attributeValues facet indexes (PH1-05)", () => {
  test("typed by_attribute_* ranges answer value filters; by_product lists specs", async () => {
    const t = setup();
    const rows = await t.run(async (ctx) => {
      const base = { createdAt: 1, updatedAt: 1 };
      const attribute = (name: string, type: "text" | "number" | "boolean" | "date") =>
        ctx.db.insert("attributeDefinitions", {
          name,
          type,
          unit: undefined,
          options: [],
          ...base,
        });
      const colour = await attribute("Colour", "text");
      const weight = await attribute("Weight", "number");
      const rohs = await attribute("RoHS", "boolean");
      const service = await attribute("Next service", "date");
      const product = (name: string) =>
        ctx.db.insert("products", {
          name,
          slug: name.toLowerCase(),
          sku: name.toUpperCase(),
          status: "active" as const,
          categoryIds: [],
          ...base,
        });
      const p1 = await product("P1");
      const p2 = await product("P2");
      const value = (
        productId: Id<"products">,
        attributeId: Id<"attributeDefinitions">,
        extra:
          | { valueText: string }
          | { valueNumber: number }
          | { valueBoolean: boolean }
          | { valueDate: number },
      ) => ctx.db.insert("attributeValues", { productId, attributeId, ...extra, ...base });

      // P1: multi-select Colour as one row per option, plus typed values.
      await value(p1, colour, { valueText: "Black" });
      await value(p1, colour, { valueText: "Silver" });
      await value(p1, weight, { valueNumber: 3.5 });
      await value(p1, rohs, { valueBoolean: true });
      await value(p1, service, { valueDate: 1_700_000_000_000 });
      // P2 shares Colour=Black and has a heavier Weight.
      await value(p2, colour, { valueText: "Black" });
      await value(p2, weight, { valueNumber: 7 });
      return { colour, weight, rohs, service, p1, p2 };
    });
    const { colour, weight, rohs, service, p1, p2 } = rows;

    const ids = (found: { _id: Id<"attributeValues"> }[]) => found.map((row) => row._id);

    // Specs sheet: every value of one product, in insertion order.
    const p1Values = await t.run((ctx) =>
      ctx.db
        .query("attributeValues")
        .withIndex("by_product", (q) => q.eq("productId", p1))
        .collect(),
    );
    expect(p1Values).toHaveLength(5);

    // Facet: "Colour = Black" across the catalog.
    const black = await t.run((ctx) =>
      ctx.db
        .query("attributeValues")
        .withIndex("by_attribute_text", (q) => q.eq("attributeId", colour).eq("valueText", "Black"))
        .collect(),
    );
    expect(black.map((row) => row.productId).sort()).toEqual([p1, p2].sort());

    // Numeric range facet within one attribute: Weight in [3, 5].
    const light = await t.run((ctx) =>
      ctx.db
        .query("attributeValues")
        .withIndex("by_attribute_number", (q) =>
          q.eq("attributeId", weight).gte("valueNumber", 3).lte("valueNumber", 5),
        )
        .collect(),
    );
    expect(ids(light)).toHaveLength(1);
    expect(light[0].productId).toBe(p1);

    // Boolean + date columns are indexed the same way.
    const rohsTrue = await t.run((ctx) =>
      ctx.db
        .query("attributeValues")
        .withIndex("by_attribute_boolean", (q) =>
          q.eq("attributeId", rohs).eq("valueBoolean", true),
        )
        .collect(),
    );
    expect(rohsTrue.map((row) => row.productId)).toEqual([p1]);

    const upcoming = await t.run((ctx) =>
      ctx.db
        .query("attributeValues")
        .withIndex("by_attribute_date", (q) =>
          q.eq("attributeId", service).gte("valueDate", 1_600_000_000_000),
        )
        .collect(),
    );
    expect(upcoming.map((row) => row.productId)).toEqual([p1]);
  });
});
