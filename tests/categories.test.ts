import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { setup } from "./setup";

/**
 * Category tree (PH1-01): catalog RBAC ladder, global slug rules, nested
 * depth/cycle guards, sibling-ordering invariants, audited CRUD.
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

async function createCat(
  as: Authed,
  name: string,
  opts: {
    slug?: string;
    parentId?: Id<"categories">;
    visible?: boolean;
    description?: string;
    seoTitle?: string;
    seoDescription?: string;
  } = {},
): Promise<Id<"categories">> {
  const args: {
    name: string;
    visible: boolean;
    slug?: string;
    parentId?: Id<"categories">;
    description?: string;
    seoTitle?: string;
    seoDescription?: string;
  } = { name, visible: opts.visible ?? true };
  if (opts.slug !== undefined) args.slug = opts.slug;
  if (opts.parentId !== undefined) args.parentId = opts.parentId;
  if (opts.description !== undefined) args.description = opts.description;
  if (opts.seoTitle !== undefined) args.seoTitle = opts.seoTitle;
  if (opts.seoDescription !== undefined) args.seoDescription = opts.seoDescription;
  const { id } = await as.mutation(api.catalog.categories.create, args);
  return id;
}

/** Root rows ordered by `position` (names) — the visible top level. */
async function rootNames(t: T): Promise<string[]> {
  const rows = await t.run((ctx) => ctx.db.query("categories").collect());
  return rows
    .filter((row) => row.parentId === undefined)
    .sort((a, b) => a.position - b.position)
    .map((row) => row.name);
}

/** Sibling positions grouped by parent ("root" = no parent), sorted. */
async function siblingPositions(t: T): Promise<Record<string, number[]>> {
  const rows = await t.run((ctx) => ctx.db.query("categories").collect());
  const groups: Record<string, number[]> = {};
  for (const row of rows) {
    const key = row.parentId ?? "root";
    (groups[key] ??= []).push(row.position);
  }
  for (const key of Object.keys(groups)) groups[key].sort((a, b) => a - b);
  return groups;
}

/** An id of the right type whose document doesn't exist. */
async function missingCategoryId(t: T): Promise<Id<"categories">> {
  const id = await t.run((ctx) =>
    ctx.db.insert("categories", {
      name: "temp",
      slug: "temp",
      visible: true,
      position: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  await t.run((ctx) => ctx.db.delete(id));
  return id;
}

describe("category permissions (PH1-01)", () => {
  test("catalog matrix: view widely, create/edit for sales, delete owner/admin only", async () => {
    const t = setup();
    const owner = await seedUser(t, "owner@example.com");
    const sales = await seedUser(t, "sales@example.com");
    const warehouse = await seedUser(t, "warehouse@example.com");
    const accountant = await seedUser(t, "accountant@example.com");
    await grant(t, owner, "owner");
    await grant(t, sales, "sales");
    await grant(t, warehouse, "warehouse");
    await grant(t, accountant, "accountant");

    await expect(t.query(api.catalog.categories.list, {})).rejects.toThrow("Not authenticated");
    await expect(
      t.mutation(api.catalog.categories.create, { name: "X", visible: true }),
    ).rejects.toThrow("Not authenticated");

    // Warehouse + Accountant: view only.
    for (const member of [warehouse, accountant]) {
      const viewer = t.withIdentity({ subject: `${member}|session-1` });
      expect(await viewer.query(api.catalog.categories.list, {})).toEqual([]);
      await expect(
        viewer.mutation(api.catalog.categories.create, { name: "X", visible: true }),
      ).rejects.toThrow("You don't have permission to create catalog items.");
    }

    // Sales: view/create/edit — but NOT delete.
    const asSales = t.withIdentity({ subject: `${sales}|session-1` });
    const created = await asSales.mutation(api.catalog.categories.create, {
      name: "Sales made this",
      visible: true,
    });
    await asSales.mutation(api.catalog.categories.update, {
      id: created.id,
      name: "Sales renamed this",
      visible: false,
    });
    await asSales.mutation(api.catalog.categories.move, { id: created.id, position: 0 });
    await expect(
      asSales.mutation(api.catalog.categories.remove, { id: created.id }),
    ).rejects.toThrow("You don't have permission to delete catalog items.");

    // Owner: delete works.
    const asOwner = t.withIdentity({ subject: `${owner}|session-1` });
    await asOwner.mutation(api.catalog.categories.remove, { id: created.id });
    expect(await t.run((ctx) => ctx.db.query("categories").collect())).toHaveLength(0);
  });
});

describe("categories:create (PH1-01)", () => {
  test("auto-slugs with collision suffixes; explicit slugs normalize and must be unique", async () => {
    const t = setup();
    const as = await ownerTools(t);

    const a = await createCat(as, "Ultrasound Machines");
    const b = await createCat(as, "Scanner X", { slug: "  Hand-Held!! Scanner  " });
    // Third "Ultrasound Machines" collides → suffixed, not rejected.
    const c = await createCat(as, "Ultrasound Machines");
    const rows = await t.run((ctx) => ctx.db.query("categories").collect());
    const byId = new Map(rows.map((row) => [row._id, row]));
    expect(byId.get(a)?.slug).toBe("ultrasound-machines");
    expect(byId.get(b)?.slug).toBe("hand-held-scanner");
    expect(byId.get(c)?.slug).toBe("ultrasound-machines-2");

    // Explicit duplicates fail — even across parents (slugs are global).
    await expect(createCat(as, "Other", { slug: "ultrasound-machines" })).rejects.toThrow(
      'A category with slug "ultrasound-machines" already exists.',
    );
    await expect(
      createCat(as, "Nested dup", { parentId: a, slug: "hand-held-scanner" }),
    ).rejects.toThrow("already exists");

    // A legal child audits with parentId + depth 2.
    await createCat(as, "Probe", { parentId: a });

    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit).toHaveLength(4);
    expect(audit[0]).toMatchObject({
      action: "create",
      entity: "categories",
      actorLabel: "owner@example.com",
      after: { name: "Ultrasound Machines", slug: "ultrasound-machines", position: 0, depth: 1 },
    });
    expect(audit[2].after).toMatchObject({ slug: "ultrasound-machines-2", position: 2, depth: 1 });
    expect(audit[3].after).toMatchObject({ parentId: a, depth: 2, position: 0 });
  });

  test("validates names, SEO caps, slugs, parents, and the depth limit", async () => {
    const t = setup();
    const as = await ownerTools(t);

    await expect(createCat(as, "   ")).rejects.toThrow(
      "Category name must be between 1 and 100 characters.",
    );
    await expect(createCat(as, "x".repeat(101))).rejects.toThrow(
      "Category name must be between 1 and 100 characters.",
    );
    await expect(createCat(as, "Ok", { seoTitle: "x".repeat(101) })).rejects.toThrow(
      "SEO title must be 100 characters or fewer.",
    );
    await expect(createCat(as, "Ok", { seoDescription: "x".repeat(301) })).rejects.toThrow(
      "SEO description must be 300 characters or fewer.",
    );
    await expect(createCat(as, "Ok", { slug: "!!!" })).rejects.toThrow(
      "Slug must contain at least one letter or number.",
    );
    await expect(createCat(as, "Ok", { slug: "a".repeat(61) })).rejects.toThrow(
      "Slug must be 60 characters or fewer.",
    );
    await expect(
      createCat(as, "Orphan child", { parentId: await missingCategoryId(t) }),
    ).rejects.toThrow("The parent category no longer exists.");

    // Depth: root(1) … 6 levels fit; the 7th is refused.
    let parentId: Id<"categories"> | undefined;
    for (let level = 1; level <= 6; level += 1) {
      parentId = await createCat(as, `Level ${level}`, { parentId });
    }
    await expect(createCat(as, "Level 7", { parentId })).rejects.toThrow(
      "Categories can be nested at most 6 levels deep.",
    );
    expect(await t.run((ctx) => ctx.db.query("categories").collect())).toHaveLength(6);
    expect(await t.run((ctx) => ctx.db.query("auditLog").collect())).toHaveLength(6);
  });
});

describe("categories:update (PH1-01)", () => {
  test("renames keep the slug unless one is sent; full-form clears; no-op silent", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const id = await createCat(as, "Old Name", {
      description: "Keep me?",
      seoTitle: "SEO",
      seoDescription: "Meta",
    });

    // Rename with no slug in the payload → URL stability.
    await as.mutation(api.catalog.categories.update, {
      id,
      name: "New Name",
      visible: true,
      description: "Keep me?",
      seoTitle: "SEO",
      seoDescription: "Meta",
    });
    let row = (await t.run((ctx) => ctx.db.get(id)))!;
    expect(row).toMatchObject({ name: "New Name", slug: "old-name" });

    // "" re-derives from the current name; omitted desc/seo cleared (full form).
    await as.mutation(api.catalog.categories.update, {
      id,
      name: "New Name",
      slug: "",
      visible: true,
    });
    row = (await t.run((ctx) => ctx.db.get(id)))!;
    expect(row.slug).toBe("new-name");
    expect(row.description).toBeUndefined();
    expect(row.seoTitle).toBeUndefined();
    expect(row.seoDescription).toBeUndefined();

    // Explicit slug collision → refused.
    await createCat(as, "Taken");
    await expect(
      as.mutation(api.catalog.categories.update, {
        id,
        name: "New Name",
        slug: "taken",
        visible: true,
      }),
    ).rejects.toThrow('A category with slug "taken" already exists.');

    // Identical payload records nothing. Audits so far: create "Old Name",
    // update (rename), update (re-derive slug + clear seo), create "Taken".
    const countBefore = (await t.run((ctx) => ctx.db.query("auditLog").collect())).length;
    expect(countBefore).toBe(4);
    await as.mutation(api.catalog.categories.update, {
      id,
      name: "New Name",
      slug: "new-name",
      visible: true,
    });
    expect(await t.run((ctx) => ctx.db.query("auditLog").collect())).toHaveLength(countBefore);

    await expect(
      as.mutation(api.catalog.categories.update, {
        id: await missingCategoryId(t),
        name: "Ghost",
        visible: true,
      }),
    ).rejects.toThrow("This category no longer exists.");
  });
});

describe("categories:move (PH1-01)", () => {
  test("reorders within siblings (clamped) and keeps positions compact", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const a = await createCat(as, "A");
    const b = await createCat(as, "B");
    const c = await createCat(as, "C"); // root: A(0) B(1) C(2)
    expect(await rootNames(t)).toEqual(["A", "B", "C"]);

    // Drag C to the front.
    await as.mutation(api.catalog.categories.move, { id: c, position: 0 });
    expect(await rootNames(t)).toEqual(["C", "A", "B"]);
    expect(await siblingPositions(t)).toEqual({ root: [0, 1, 2] });

    // Clamped: past the end appends …
    await as.mutation(api.catalog.categories.move, { id: a, position: 99 });
    expect(await rootNames(t)).toEqual(["C", "B", "A"]);
    // … and a negative position pins to the front.
    await as.mutation(api.catalog.categories.move, { id: b, position: -5 });
    expect(await rootNames(t)).toEqual(["B", "C", "A"]);
    expect(await siblingPositions(t)).toEqual({ root: [0, 1, 2] });

    // No-op (same parent + same position) records nothing; bad input fails.
    // Audits so far: 3 creates + 3 moves = 6.
    const audits = (await t.run((ctx) => ctx.db.query("auditLog").collect())).length;
    expect(audits).toBe(6);
    await as.mutation(api.catalog.categories.move, { id: b, position: 0 });
    expect(await t.run((ctx) => ctx.db.query("auditLog").collect())).toHaveLength(audits);
    await expect(
      as.mutation(api.catalog.categories.move, { id: a, position: 1.5 }),
    ).rejects.toThrow("Position must be a whole number.");
    await expect(
      as.mutation(api.catalog.categories.move, { id: await missingCategoryId(t), position: 0 }),
    ).rejects.toThrow("This category no longer exists.");
  });

  test("reparents across parents, moves to root, and compacts both sibling sets", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const p = await createCat(as, "P");
    const q = await createCat(as, "Q");
    const x = await createCat(as, "X", { parentId: p });
    const y = await createCat(as, "Y", { parentId: p }); // P: X(0) Y(1)

    await as.mutation(api.catalog.categories.move, { id: x, newParentId: q, position: 0 });
    expect(await siblingPositions(t)).toEqual({
      root: [0, 1],
      [p]: [0], // Y compacted into the gap X left
      [q]: [0],
    });
    // 4 creates precede the move — filter to the move itself.
    const moves = (await t.run((ctx) => ctx.db.query("auditLog").collect())).filter(
      (entry) => entry.action === "move",
    );
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({
      entity: "categories",
      entityId: x,
      before: { parentId: p, position: 0 },
      after: { parentId: q, position: 0 },
    });

    // To root: appended after the existing roots.
    await as.mutation(api.catalog.categories.move, { id: x, position: 99 });
    expect(await rootNames(t)).toEqual(["P", "Q", "X"]);

    // Moving into a different branch is fine; into your own subtree isn't.
    await as.mutation(api.catalog.categories.move, { id: x, newParentId: y, position: 0 });
    await expect(
      as.mutation(api.catalog.categories.move, { id: p, newParentId: y, position: 0 }),
    ).rejects.toThrow("A category can't be moved inside one of its own subcategories.");
    await expect(
      as.mutation(api.catalog.categories.move, { id: p, newParentId: p, position: 0 }),
    ).rejects.toThrow("A category can't be moved inside itself.");
    await expect(
      as.mutation(api.catalog.categories.move, {
        id: p,
        newParentId: await missingCategoryId(t),
        position: 0,
      }),
    ).rejects.toThrow("The parent category no longer exists.");
  });

  test("a subtree can't move deeper than MAX_DEPTH (6)", async () => {
    const t = setup();
    const as = await ownerTools(t);
    // Chain R1(1) … R5(5).
    let chain: Id<"categories"> | undefined;
    for (let level = 1; level <= 5; level += 1) {
      chain = await createCat(as, `R${level}`, { parentId: chain });
    }
    const r4 = (await t.run((ctx) => ctx.db.query("categories").collect())).find(
      (row) => row.name === "R4",
    )!;
    // Sibling pair with a subtree of height 2.
    const t1 = await createCat(as, "T1");
    await createCat(as, "T2", { parentId: t1 });

    // T1 under R5 → depth 6 + height 2 − 1 = 7 > 6.
    await expect(
      as.mutation(api.catalog.categories.move, { id: t1, newParentId: chain!, position: 0 }),
    ).rejects.toThrow("Categories can be nested at most 6 levels deep.");

    // One level up fits: under R4 → depth 5 + 2 − 1 = 6.
    await as.mutation(api.catalog.categories.move, { id: t1, newParentId: r4._id, position: 0 });
    const t1Row = (await t.run((ctx) => ctx.db.get(t1)))!;
    expect(t1Row.parentId).toBe(r4._id);
    // Nested chain: R1 root → R2…R5 each under the previous; R4 now holds
    // [R5, T1] and T1 holds [T2]. Every sibling set must stay 0..n-1.
    const byName = new Map(
      (await t.run((ctx) => ctx.db.query("categories").collect())).map((row) => [row.name, row]),
    );
    const positions = await siblingPositions(t);
    expect(Object.keys(positions)).toHaveLength(6); // root, R1…R4, T1 (R5/T2 childless)
    expect(positions).toEqual({
      root: [0],
      [byName.get("R1")!._id]: [0],
      [byName.get("R2")!._id]: [0],
      [byName.get("R3")!._id]: [0],
      [r4._id]: [0, 1],
      [t1]: [0],
    });
  });
});

describe("categories:remove (PH1-01)", () => {
  test("blocked while subcategories exist; leaf deletion compacts and audits", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const parent = await createCat(as, "Parent"); // root 0
    const lone = await createCat(as, "Lone child", { parentId: parent });
    await createCat(as, "A"); // root 1
    const b = await createCat(as, "B"); // root 2
    await createCat(as, "C"); // root 3

    await expect(as.mutation(api.catalog.categories.remove, { id: parent })).rejects.toThrow(
      "This category has 1 subcategory — move or delete them first.",
    );
    const second = await createCat(as, "Second child", { parentId: parent });
    await expect(as.mutation(api.catalog.categories.remove, { id: parent })).rejects.toThrow(
      "This category has 2 subcategories — move or delete them first.",
    );

    // Deleting a middle root compacts its sibling set: [Parent, A, C].
    await as.mutation(api.catalog.categories.remove, { id: b });
    expect(await siblingPositions(t)).toEqual({ root: [0, 1, 2], [parent]: [0, 1] });
    expect(await rootNames(t)).toEqual(["Parent", "A", "C"]);

    // Children go first, then the now-leaf parent.
    await as.mutation(api.catalog.categories.remove, { id: lone });
    await expect(as.mutation(api.catalog.categories.remove, { id: parent })).rejects.toThrow(
      "This category has 1 subcategory — move or delete them first.",
    );
    await as.mutation(api.catalog.categories.remove, { id: second });
    await as.mutation(api.catalog.categories.remove, { id: parent }); // leaf now — succeeds

    await expect(
      as.mutation(api.catalog.categories.remove, { id: await missingCategoryId(t) }),
    ).rejects.toThrow("This category no longer exists.");

    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    const deletes = audit.filter((entry) => entry.action === "delete");
    expect(deletes).toHaveLength(4); // B, lone, second, parent
    expect(deletes[1]).toMatchObject({
      entity: "categories",
      entityId: lone,
      before: { name: "Lone child", slug: "lone-child", parentId: parent, position: 0 },
    });
    expect(deletes[1].after).toBeUndefined();
  });
});

describe("categories:list (PH1-01)", () => {
  test("DFS order with computed depth and path", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const a = await createCat(as, "A");
    const b = await createCat(as, "B");
    const a1 = await createCat(as, "A1", { parentId: a });
    const a2 = await createCat(as, "A2", { parentId: a, visible: false });

    const rows = await as.query(api.catalog.categories.list, {});
    expect(rows.map((row) => row.name)).toEqual(["A", "A1", "A2", "B"]);
    expect(rows.map((row) => row.depth)).toEqual([1, 2, 2, 1]);
    expect(rows.map((row) => row.path)).toEqual([[a], [a, a1], [a, a2], [b]]);
    expect(rows.map((row) => row.visible)).toEqual([true, true, false, true]);
    expect(rows[0]).toMatchObject({ slug: "a", position: 0 });
  });
});

describe("categories:stats (PH1-02)", () => {
  async function insertProduct(
    t: T,
    sku: string,
    opts: { status?: "draft" | "active" | "archived"; categoryIds?: Id<"categories">[] } = {},
  ) {
    return await t.run((ctx) =>
      ctx.db.insert("products", {
        name: sku,
        slug: sku.toLowerCase(),
        sku,
        status: opts.status ?? "active",
        categoryIds: opts.categoryIds ?? [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
  }

  test("counts draft+active per category, buckets uncategorized, excludes archived", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const root = await createCat(as, "Root");
    const child = await createCat(as, "Child", { parentId: root });

    await insertProduct(t, "P1", { categoryIds: [root] });
    await insertProduct(t, "P2", { categoryIds: [child] });
    await insertProduct(t, "P3", { categoryIds: [root, child] }); // in several categories
    await insertProduct(t, "P4"); // uncategorized
    await insertProduct(t, "P5", { status: "draft", categoryIds: [child] }); // drafts count
    await insertProduct(t, "P6", { status: "archived", categoryIds: [child] }); // archived doesn't
    await insertProduct(t, "P7", { status: "archived" }); // …not even in uncategorized

    const stats = await as.query(api.catalog.categories.stats, {});
    expect(stats.byCategory).toEqual({ [root]: 2, [child]: 3 });
    expect(stats.uncategorized).toBe(1);
  });

  test("stats is catalog.view — strangers refused, warehouse sees empty buckets", async () => {
    const t = setup();
    await expect(t.query(api.catalog.categories.stats, {})).rejects.toThrow("Not authenticated");

    const warehouse = await seedUser(t, "warehouse@example.com");
    await grant(t, warehouse, "warehouse");
    const viewer = t.withIdentity({ subject: `${warehouse}|session-1` });
    expect(await viewer.query(api.catalog.categories.stats, {})).toEqual({
      byCategory: {},
      uncategorized: 0,
    });
  });
});
