import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { setup } from "./setup";

/**
 * Attribute sets (PH1-04): grouping definitions into sets, assigning sets
 * to categories, the inheritance resolver (`attributes.forCategory` —
 * union across covering sets, deduped, name order), the delete reference
 * check promised by PH1-03 (a definition can't go while a set uses it),
 * plus the catalog RBAC ladder and audited CRUD.
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

async function roleTools(t: T, email: string, roleKey: string) {
  const user = await seedUser(t, email);
  await grant(t, user, roleKey);
  return t.withIdentity({ subject: `${user}|session-1` });
}

async function createDef(
  as: Authed,
  name: string,
  opts: { type?: "text" | "number" | "select"; unit?: string; options?: string[] } = {},
): Promise<Id<"attributeDefinitions">> {
  const args: {
    name: string;
    type: "text" | "number" | "select";
    unit?: string;
    options?: string[];
  } = { name, type: opts.type ?? "text" };
  if (opts.unit !== undefined) args.unit = opts.unit;
  if (opts.options !== undefined) args.options = opts.options;
  const { id } = await as.mutation(api.catalog.attributes.create, args);
  return id;
}

async function createCat(as: Authed, name: string): Promise<Id<"categories">> {
  const { id } = await as.mutation(api.catalog.categories.create, { name, visible: true });
  return id;
}

/** Audit entries for sets only — the helpers above write their own. */
function setAudit(t: T) {
  return t
    .run((ctx) => ctx.db.query("auditLog").collect())
    .then((rows) => rows.filter((row) => row.entity === "attributeSets"));
}

describe("attributeSets:create (PH1-04)", () => {
  test("groups definitions and assigns categories, deduping ids; audited", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const weight = await createDef(as, "Weight", { type: "number", unit: "kg" });
    const colour = await createDef(as, "Colour", { type: "select", options: ["Black"] });
    const catA = await createCat(as, "Alpha");
    const catB = await createCat(as, "Beta");

    const { id } = await as.mutation(api.catalog.attributeSets.create, {
      name: "  Physical specs  ",
      attributeIds: [weight, colour, weight],
      categoryIds: [catA, catB, catA],
    });

    const rows = await as.query(api.catalog.attributeSets.list, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      _id: id,
      name: "Physical specs", // trimmed
      attributeIds: [weight, colour], // first occurrence wins, order kept
      categoryIds: [catA, catB],
    });

    const entries = await setAudit(t);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: "create",
      entity: "attributeSets",
      entityId: id,
      after: { name: "Physical specs", attributeIds: [weight, colour], categoryIds: [catA, catB] },
    });
  });

  test("rejects blank names and references that no longer exist", async () => {
    const t = setup();
    const as = await ownerTools(t);

    await expect(as.mutation(api.catalog.attributeSets.create, { name: "   " })).rejects.toThrow(
      "Set name must be between 1 and 100 characters.",
    );

    // An id that passes the type validator but has no document behind it.
    const goneDef = await createDef(as, "Ephemeral");
    await as.mutation(api.catalog.attributes.remove, { id: goneDef });
    await expect(
      as.mutation(api.catalog.attributeSets.create, {
        name: "Specs",
        attributeIds: [goneDef],
      }),
    ).rejects.toThrow("One of those attributes no longer exists.");

    const goneCat = await createCat(as, "Temporary");
    await as.mutation(api.catalog.categories.remove, { id: goneCat });
    await expect(
      as.mutation(api.catalog.attributeSets.create, {
        name: "Specs",
        categoryIds: [goneCat],
      }),
    ).rejects.toThrow("One of those categories no longer exists.");

    expect(await as.query(api.catalog.attributeSets.list, {})).toEqual([]);
    expect(await setAudit(t)).toEqual([]);
  });
});

describe("attributeSets:update (PH1-04)", () => {
  test("full-form reassignment with before/after audit; no-op records nothing", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const weight = await createDef(as, "Weight", { type: "number" });
    const colour = await createDef(as, "Colour");
    const catA = await createCat(as, "Alpha");
    const catB = await createCat(as, "Beta");
    const { id } = await as.mutation(api.catalog.attributeSets.create, {
      name: "Specs",
      attributeIds: [weight],
      categoryIds: [catA],
    });

    // Same payload again → no change, no audit entry.
    await as.mutation(api.catalog.attributeSets.update, {
      id,
      name: "Specs",
      attributeIds: [weight],
      categoryIds: [catA],
    });
    expect(await setAudit(t)).toHaveLength(1); // just the create

    await as.mutation(api.catalog.attributeSets.update, {
      id,
      name: "Full specs",
      attributeIds: [weight, colour],
      categoryIds: [catB],
    });
    const entries = await setAudit(t);
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({
      action: "update",
      entity: "attributeSets",
      entityId: id,
      before: { name: "Specs", attributeIds: [weight], categoryIds: [catA] },
      after: { name: "Full specs", attributeIds: [weight, colour], categoryIds: [catB] },
    });

    // Delete the set, then update its former id → clear error.
    await as.mutation(api.catalog.attributeSets.remove, { id });
    await expect(
      as.mutation(api.catalog.attributeSets.update, { id, name: "Ghost" }),
    ).rejects.toThrow("This attribute set no longer exists.");
  });
});

describe("attributeSets:remove (PH1-04)", () => {
  test("deletes with an audit snapshot; missing row errors", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const weight = await createDef(as, "Weight", { type: "number" });
    const catA = await createCat(as, "Alpha");
    const { id } = await as.mutation(api.catalog.attributeSets.create, {
      name: "Specs",
      attributeIds: [weight],
      categoryIds: [catA],
    });

    await as.mutation(api.catalog.attributeSets.remove, { id });
    expect(await as.query(api.catalog.attributeSets.list, {})).toEqual([]);

    const entries = await setAudit(t);
    expect(entries[1]).toMatchObject({
      action: "delete",
      entity: "attributeSets",
      entityId: id,
      before: { name: "Specs", attributeIds: [weight], categoryIds: [catA] },
    });
    expect(entries[1].after).toBeUndefined();

    await expect(as.mutation(api.catalog.attributeSets.remove, { id })).rejects.toThrow(
      "This attribute set no longer exists.",
    );
  });

  test("RBAC: warehouse can read but not create/edit/delete; sales can't delete", async () => {
    const t = setup();
    const owner = await ownerTools(t);
    const weight = await createDef(owner, "Weight");
    const { id } = await owner.mutation(api.catalog.attributeSets.create, {
      name: "Specs",
      attributeIds: [weight],
    });

    const warehouse = await roleTools(t, "dave@example.com", "warehouse");
    expect(await warehouse.query(api.catalog.attributeSets.list, {})).toHaveLength(1);
    await expect(
      warehouse.mutation(api.catalog.attributeSets.create, { name: "Nope" }),
    ).rejects.toThrow("You don't have permission to create catalog items.");
    await expect(
      warehouse.mutation(api.catalog.attributeSets.update, { id, name: "Nope" }),
    ).rejects.toThrow("You don't have permission to edit catalog items.");
    await expect(warehouse.mutation(api.catalog.attributeSets.remove, { id })).rejects.toThrow(
      "You don't have permission to delete catalog items.",
    );

    const sales = await roleTools(t, "sara@example.com", "sales");
    await sales.mutation(api.catalog.attributeSets.create, { name: "Sales set" });
    await sales.mutation(api.catalog.attributeSets.update, {
      id,
      name: "Renamed",
      attributeIds: [weight], // full-form: keeps the existing membership
    });
    await expect(sales.mutation(api.catalog.attributeSets.remove, { id })).rejects.toThrow(
      "You don't have permission to delete catalog items.",
    );
  });
});

describe("attributes:remove reference check (PH1-04)", () => {
  test("blocked while a set uses it, freed once the set drops it", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const weight = await createDef(as, "Weight", { type: "number" });
    const colour = await createDef(as, "Colour");
    const { id: setId } = await as.mutation(api.catalog.attributeSets.create, {
      name: "Specs",
      attributeIds: [weight, colour],
    });

    await expect(as.mutation(api.catalog.attributes.remove, { id: weight })).rejects.toThrow(
      "This attribute is used by 1 attribute set — remove it there first.",
    );
    expect(await as.query(api.catalog.attributes.list, {})).toHaveLength(2);

    // Drop it from the set → now deletable.
    await as.mutation(api.catalog.attributeSets.update, {
      id: setId,
      name: "Specs",
      attributeIds: [colour],
      categoryIds: [],
    });
    await as.mutation(api.catalog.attributes.remove, { id: weight });
    expect(await as.query(api.catalog.attributes.list, {})).toHaveLength(1);
  });
});

describe("attributes:forCategory inheritance (PH1-04)", () => {
  test("unions every covering set, deduped, in set-name order", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const weight = await createDef(as, "Weight", { type: "number", unit: "kg" });
    const colour = await createDef(as, "Colour", { type: "select", options: ["Black"] });
    const dims = await createDef(as, "Dimensions");
    const catA = await createCat(as, "Alpha");
    const catB = await createCat(as, "Beta");

    await as.mutation(api.catalog.attributeSets.create, {
      name: "Base specs", // sorts first
      attributeIds: [weight, colour],
      categoryIds: [catA],
    });
    await as.mutation(api.catalog.attributeSets.create, {
      name: "Extended specs",
      attributeIds: [colour, dims], // colour already contributed by Base
      categoryIds: [catA, catB],
    });

    const inA = await as.query(api.catalog.attributes.forCategory, { categoryId: catA });
    expect(inA.map((row) => row._id)).toEqual([weight, colour, dims]); // deduped
    expect(inA[0]).toMatchObject({ name: "Weight", type: "number", unit: "kg" });

    const inB = await as.query(api.catalog.attributes.forCategory, { categoryId: catB });
    expect(inB.map((row) => row._id)).toEqual([colour, dims]);

    const goneCat = await createCat(as, "Temporary");
    await as.mutation(api.catalog.categories.remove, { id: goneCat });
    await expect(
      as.query(api.catalog.attributes.forCategory, { categoryId: goneCat }),
    ).rejects.toThrow("This category no longer exists.");
  });

  test("RBAC: strangers refused; warehouse (view) resolves", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const cat = await createCat(as, "Alpha");
    await as.mutation(api.catalog.attributeSets.create, {
      name: "Specs",
      categoryIds: [cat],
    });

    await expect(t.query(api.catalog.attributes.forCategory, { categoryId: cat })).rejects.toThrow(
      "Not authenticated",
    );
    const warehouse = await roleTools(t, "dave@example.com", "warehouse");
    expect(await warehouse.query(api.catalog.attributes.forCategory, { categoryId: cat })).toEqual(
      [],
    );
  });
});
