import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { setup } from "./setup";

/**
 * Product list + bulk status (PH1-08): the admin table's backend —
 * filters (category/brand/status/tracking flags), substring search over
 * name/SKU/barcode, column sort with deterministic tiebreaks, bounded
 * pages, the brands facet, and the batched status change that audits per
 * changed row (and records nothing for no-ops — PH0-30).
 *
 * Auth identity: `getAuthUserId` takes the part of `subject` before `|`.
 */

type T = ReturnType<typeof setup>;

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

/**
 * Minimal product rows — PH1-06 fields are optional in the schema, so the
 * fixtures state only what a filter/sort assertion needs (the mutations
 * keep full rows; the list must read both shapes).
 */
type ProductSeed = {
  name: string;
  sku: string;
  status?: "draft" | "active" | "archived";
  brand?: string;
  barcode?: string;
  categoryIds?: Id<"categories">[];
  serialTracked?: boolean;
  lotTracked?: boolean;
  expiryRequired?: boolean;
  warrantyEligible?: boolean;
  allowBackorder?: boolean;
  updatedAt?: number;
};

async function insertProduct(t: T, seed: ProductSeed) {
  return await t.run((ctx) =>
    ctx.db.insert("products", {
      name: seed.name,
      slug: seed.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
      sku: seed.sku,
      status: seed.status ?? "active",
      categoryIds: seed.categoryIds ?? [],
      ...(seed.brand !== undefined ? { brand: seed.brand } : {}),
      ...(seed.barcode !== undefined ? { barcode: seed.barcode } : {}),
      ...(seed.serialTracked !== undefined ? { serialTracked: seed.serialTracked } : {}),
      ...(seed.lotTracked !== undefined ? { lotTracked: seed.lotTracked } : {}),
      ...(seed.expiryRequired !== undefined ? { expiryRequired: seed.expiryRequired } : {}),
      ...(seed.warrantyEligible !== undefined ? { warrantyEligible: seed.warrantyEligible } : {}),
      ...(seed.allowBackorder !== undefined ? { allowBackorder: seed.allowBackorder } : {}),
      createdAt: 1,
      updatedAt: seed.updatedAt ?? 1,
    }),
  );
}

async function seedCategory(t: T, name: string) {
  return await t.run((ctx) =>
    ctx.db.insert("categories", {
      name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      visible: true,
      position: 0,
      createdAt: 1,
      updatedAt: 1,
    }),
  );
}

async function auditRows(t: T) {
  const rows = await t.run((ctx) => ctx.db.query("auditLog").collect());
  return rows.filter((row) => row.entity === "products");
}

/* ------------------------------------------------------------------ list */

/** The query's args as a local structural type (keeps `ids()` helpers typed). */
type ListArgs = {
  search?: string;
  categoryId?: Id<"categories">;
  brand?: string;
  status?: "draft" | "active" | "archived";
  flags?: Array<
    "serialTracked" | "lotTracked" | "expiryRequired" | "warrantyEligible" | "allowBackorder"
  >;
  sort?: {
    key: "name" | "sku" | "brand" | "status" | "updatedAt";
    direction: "asc" | "desc";
  };
  limit?: number;
};

describe("products:list (PH1-08)", () => {
  test("requires catalog view; bounded page with total/hasMore", async () => {
    const t = setup();
    const as = await ownerTools(t);
    await insertProduct(t, { name: "Alpha Scanner", sku: "LST-1" });
    await insertProduct(t, { name: "Beta Mixer", sku: "LST-2" });
    await insertProduct(t, { name: "Gamma Oven", sku: "LST-3" });

    await expect(t.query(api.catalog.products.list, {})).rejects.toThrow("Not authenticated");

    const first = await as.query(api.catalog.products.list, {});
    expect(first.total).toBe(3);
    expect(first.rows).toHaveLength(3);
    expect(first.hasMore).toBe(false);

    const page = await as.query(api.catalog.products.list, { limit: 2 });
    expect(page.rows).toHaveLength(2);
    expect(page.total).toBe(3);
    expect(page.hasMore).toBe(true);

    // limit clamps to ≥1 (0 would silently show an "empty" table).
    expect((await as.query(api.catalog.products.list, { limit: 0 })).rows).toHaveLength(1);

    // Warehouse (view-only) can read the list.
    const member = await seedUser(t, "warehouse@example.com");
    await grant(t, member, "warehouse");
    const viewer = t.withIdentity({ subject: `${member}|session-1` });
    expect((await viewer.query(api.catalog.products.list, {})).total).toBe(3);
  });

  test("search matches name, SKU and barcode case-insensitively", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const alpha = await insertProduct(t, {
      name: "Alpha Scanner",
      sku: "ALP-1",
      barcode: "4006381333931",
    });
    const beta = await insertProduct(t, { name: "Beta Mixer", sku: "BET-9" });

    const search = async (needle: string) => {
      const result = await as.query(api.catalog.products.list, { search: needle });
      return result.rows.map((row) => row._id).sort();
    };

    expect(await search("alpha")).toEqual([alpha]); // name substring
    expect(await search("ALPHA")).toEqual([alpha]); // case-insensitive query
    expect(await search("  alp  ")).toEqual([alpha]); // trimmed
    expect(await search("et-9")).toEqual([beta]); // SKU substring
    expect(await search("638133")).toEqual([alpha]); // barcode substring
    expect(await search("nope")).toEqual([]);
    expect((await as.query(api.catalog.products.list, { search: "nope" })).total).toBe(0);
  });

  test("filters by status, brand, category and flags (AND)", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const imaging = await seedCategory(t, "Imaging");
    const serial = await insertProduct(t, {
      name: "Serial Scanner",
      sku: "FLT-1",
      status: "active",
      brand: "AlphaCo",
      categoryIds: [imaging],
      serialTracked: true,
      warrantyEligible: true,
    });
    const lot = await insertProduct(t, {
      name: "Lot Batch",
      sku: "FLT-2",
      status: "draft",
      brand: "AlphaCo",
      lotTracked: true,
    });
    const plain = await insertProduct(t, {
      name: "Plain Item",
      sku: "FLT-3",
      status: "archived",
      categoryIds: [imaging],
    });

    const ids = async (args: ListArgs) =>
      (await as.query(api.catalog.products.list, args)).rows.map((row) => row._id).sort();

    expect(await ids({ status: "active" })).toEqual([serial]);
    expect(await ids({ status: "draft" })).toEqual([lot]);
    expect(await ids({ brand: "AlphaCo" })).toEqual([serial, lot].sort());
    expect(await ids({ brand: "GammaCo" })).toEqual([]);
    // PH1-15: archived is hidden until the status filter asks for it.
    expect(await ids({})).toEqual([serial, lot].sort());
    expect(await ids({ status: "archived" })).toEqual([plain]);
    // Category membership reads `categoryIds` (source of truth), not the join.
    expect(await ids({ categoryId: imaging })).toEqual([serial]);
    expect(await ids({ categoryId: imaging, status: "archived" })).toEqual([plain]);
    // Flags AND together: nobody is BOTH serial- and lot-tracked here.
    expect(await ids({ flags: ["serialTracked"] })).toEqual([serial]);
    expect(await ids({ flags: ["warrantyEligible"] })).toEqual([serial]);
    expect(await ids({ flags: ["serialTracked", "lotTracked"] })).toEqual([]);
    expect(await ids({ flags: [] })).toHaveLength(2);
  });

  test("filters intersect; column sort asc/desc with stable ties", async () => {
    const t = setup();
    const as = await ownerTools(t);
    await insertProduct(t, { name: "Alpha One", sku: "SRT-1", status: "active", updatedAt: 100 });
    await insertProduct(t, { name: "Alphabet Two", sku: "SRT-2", status: "draft", updatedAt: 300 });
    await insertProduct(t, { name: "beta three", sku: "SRT-3", status: "draft", updatedAt: 200 });
    const twinA = await insertProduct(t, { name: "Twin", sku: "SRT-4", updatedAt: 400 });
    const twinB = await insertProduct(t, { name: "Twin", sku: "SRT-5", updatedAt: 400 });

    // search ∩ status
    const combo = await as.query(api.catalog.products.list, { search: "alpha", status: "draft" });
    expect(combo.rows.map((row) => row.sku)).toEqual(["SRT-2"]);

    const byName = async (direction: "asc" | "desc") =>
      (await as.query(api.catalog.products.list, { sort: { key: "name", direction } })).rows.map(
        (row) => row.name,
      );

    // Case-insensitive: "beta three" sorts between the Alphas and the Twins.
    expect(await byName("asc")).toEqual([
      "Alpha One",
      "Alphabet Two",
      "beta three",
      "Twin",
      "Twin",
    ]);
    expect(await byName("desc")).toEqual([
      "Twin",
      "Twin",
      "beta three",
      "Alphabet Two",
      "Alpha One",
    ]);
    expect(
      (
        await as.query(api.catalog.products.list, { sort: { key: "updatedAt", direction: "desc" } })
      ).rows.map((row) => row.updatedAt),
    ).toEqual([400, 400, 300, 200, 100]);

    // Equal sort keys must paginate deterministically (tiebreak on _id):
    // two reads return the SAME order, and both twins are present.
    const tie1 = await as.query(api.catalog.products.list, {
      sort: { key: "name", direction: "asc" },
    });
    const tie2 = await as.query(api.catalog.products.list, {
      sort: { key: "name", direction: "asc" },
    });
    const twinOrder = (result: typeof tie1) =>
      result.rows.filter((row) => row.name === "Twin").map((row) => row._id);
    expect(twinOrder(tie1)).toEqual(twinOrder(tie2));
    expect(new Set(twinOrder(tie1))).toEqual(new Set([twinA, twinB]));
  });

  test("brands facet: distinct, sorted, non-empty — view-gated", async () => {
    const t = setup();
    const as = await ownerTools(t);
    await insertProduct(t, { name: "One", sku: "BR-1", brand: "Zeta Labs" });
    await insertProduct(t, { name: "Two", sku: "BR-2", brand: "alpha co" });
    await insertProduct(t, { name: "Three", sku: "BR-3", brand: "alpha co" });
    await insertProduct(t, { name: "Four", sku: "BR-4", brand: "" });
    await insertProduct(t, { name: "Five", sku: "BR-5" }); // legacy row: no brand
    await insertProduct(t, { name: "Six", sku: "BR-6", brand: "Gone Co", status: "archived" });

    await expect(t.query(api.catalog.products.brands, {})).rejects.toThrow("Not authenticated");
    expect(await as.query(api.catalog.products.brands, {})).toEqual(["alpha co", "Zeta Labs"]);
  });
});

/* ----------------------------------------------------------- bulkStatus */

describe("products:bulkStatus (PH1-08)", () => {
  test("changes the selection and audits per changed row; no-ops record nothing", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const a = await insertProduct(t, {
      name: "Draft A",
      sku: "BUL-1",
      status: "draft",
      updatedAt: 7,
    });
    const b = await insertProduct(t, {
      name: "Draft B",
      sku: "BUL-2",
      status: "draft",
      updatedAt: 7,
    });
    const c = await insertProduct(t, {
      name: "Active C",
      sku: "BUL-3",
      status: "active",
      updatedAt: 7,
    });

    const outcome = await as.mutation(api.catalog.products.bulkStatus, {
      ids: [a, b, c],
      status: "active",
    });
    expect(outcome).toEqual({ updated: 2, unchanged: 1 });

    const rows = await t.run((ctx) => ctx.db.query("products").collect());
    expect(rows.every((row) => row.status === "active")).toBe(true);
    // The unchanged row wasn't patched — its updatedAt survives.
    expect(rows.find((row) => row._id === c)?.updatedAt).toBe(7);
    expect(rows.find((row) => row._id === a)?.updatedAt).not.toBe(7);

    const audit = await auditRows(t);
    expect(audit).toHaveLength(2); // a and b only
    expect(audit.map((row) => row.entityId).sort()).toEqual([a, b].sort());
    expect(
      audit.every(
        (row) =>
          row.action === "update" &&
          row.actorLabel === "owner@example.com" &&
          JSON.stringify(row.before) === JSON.stringify({ status: "draft" }) &&
          JSON.stringify(row.after) === JSON.stringify({ status: "active" }),
      ),
    ).toBe(true);

    // Repeating the same batch is a full no-op: nothing written, no entries.
    expect(
      await as.mutation(api.catalog.products.bulkStatus, { ids: [a, b, c], status: "active" }),
    ).toEqual({ updated: 0, unchanged: 3 });
    expect(await auditRows(t)).toHaveLength(2);
  });

  test("duplicate ids dedupe; an empty selection is a no-op", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const e = await insertProduct(t, { name: "Twin Pick", sku: "BUL-10", status: "draft" });

    const outcome = await as.mutation(api.catalog.products.bulkStatus, {
      ids: [e, e],
      status: "active",
    });
    expect(outcome).toEqual({ updated: 1, unchanged: 0 });
    expect(await auditRows(t)).toHaveLength(1);

    expect(
      await as.mutation(api.catalog.products.bulkStatus, { ids: [], status: "archived" }),
    ).toEqual({ updated: 0, unchanged: 0 });
    expect(await auditRows(t)).toHaveLength(1);
  });

  test("a vanished id fails the whole batch before any write", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const d = await insertProduct(t, { name: "Still Draft", sku: "BUL-20", status: "draft" });
    const dead = await t.run((ctx) =>
      ctx.db.insert("products", {
        name: "Gone",
        slug: "gone-bul",
        sku: "BUL-DEAD",
        status: "draft",
        categoryIds: [],
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    await t.run((ctx) => ctx.db.delete(dead));

    await expect(
      as.mutation(api.catalog.products.bulkStatus, { ids: [d, dead], status: "active" }),
    ).rejects.toThrow("One of those products no longer exists.");
    // Nothing half-applied: d is untouched and no audit entries exist.
    const rows = await t.run((ctx) => ctx.db.query("products").collect());
    expect(rows.find((row) => row._id === d)?.status).toBe("draft");
    expect(await auditRows(t)).toHaveLength(0);
  });

  test("permission ladder: anon and view-only roles are refused", async () => {
    const t = setup();
    const owner = await seedUser(t, "owner@example.com");
    const sales = await seedUser(t, "sales@example.com");
    const warehouse = await seedUser(t, "warehouse@example.com");
    await grant(t, owner, "owner");
    await grant(t, sales, "sales");
    await grant(t, warehouse, "warehouse");
    const target = await insertProduct(t, { name: "Guarded", sku: "BUL-30", status: "draft" });

    await expect(
      t.mutation(api.catalog.products.bulkStatus, { ids: [target], status: "active" }),
    ).rejects.toThrow("Not authenticated");

    const viewer = t.withIdentity({ subject: `${warehouse}|session-1` });
    await expect(
      viewer.mutation(api.catalog.products.bulkStatus, { ids: [target], status: "active" }),
    ).rejects.toThrow("You don't have permission to edit catalog items.");
    expect((await t.run((ctx) => ctx.db.get(target)))?.status).toBe("draft");

    // Sales holds catalog.edit — the batch applies.
    const asSales = t.withIdentity({ subject: `${sales}|session-1` });
    await asSales.mutation(api.catalog.products.bulkStatus, { ids: [target], status: "active" });
    expect((await t.run((ctx) => ctx.db.get(target)))?.status).toBe("active");
  });
});
