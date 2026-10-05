import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { setup } from "./setup";

/**
 * Attribute definitions (PH1-03): catalog RBAC ladder, the type-dependent
 * shape rules (unit → number only, options → select-family only), option
 * normalization, name ordering, and audited CRUD.
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

async function createAttr(
  as: Authed,
  name: string,
  opts: {
    type?: "text" | "number" | "select" | "multi_select" | "boolean" | "date";
    unit?: string;
    options?: string[];
  } = {},
): Promise<Id<"attributeDefinitions">> {
  const args: {
    name: string;
    type: "text" | "number" | "select" | "multi_select" | "boolean" | "date";
    unit?: string;
    options?: string[];
  } = { name, type: opts.type ?? "text" };
  if (opts.unit !== undefined) args.unit = opts.unit;
  if (opts.options !== undefined) args.options = opts.options;
  const { id } = await as.mutation(api.catalog.attributes.create, args);
  return id;
}

describe("attributes:create (PH1-03)", () => {
  test("all six types round-trip with the right shape", async () => {
    const t = setup();
    const as = await ownerTools(t);

    await createAttr(as, "Compatibility", { type: "text" });
    await createAttr(as, "Weight", { type: "number", unit: "kg" });
    await createAttr(as, "Color", { type: "select", options: ["Black", "Silver"] });
    await createAttr(as, "Interfaces", { type: "multi_select", options: ["USB-C", "HDMI"] });
    await createAttr(as, "RoHS compliant", { type: "boolean" });
    await createAttr(as, "Mfg date", { type: "date" });

    const rows = await as.query(api.catalog.attributes.list, {});
    expect(rows.map((row) => row.name)).toEqual([
      "Color",
      "Compatibility",
      "Interfaces",
      "Mfg date",
      "RoHS compliant",
      "Weight", // by_name order (byte order)
    ]);
    const byName = Object.fromEntries(rows.map((row) => [row.name, row]));
    expect(byName["Weight"]).toMatchObject({ type: "number", unit: "kg", options: [] });
    expect(byName["Color"]).toMatchObject({
      type: "select",
      options: ["Black", "Silver"],
    });
    expect(byName["Compatibility"]).toMatchObject({ type: "text", options: [] });
    expect(byName["RoHS compliant"]).toMatchObject({ type: "boolean", options: [] });
    expect(byName["Mfg date"]).toMatchObject({ type: "date", options: [] });
    expect(byName["Interfaces"]).toMatchObject({
      type: "multi_select",
      options: ["USB-C", "HDMI"],
    });
    // Non-number attributes store no unit at all (key absent, not "").
    expect(byName["Color"].unit).toBeUndefined();
    expect(byName["Compatibility"].unit).toBeUndefined();
  });

  test("normalizes name, unit and options (trim, dedupe, drop blanks)", async () => {
    const t = setup();
    const as = await ownerTools(t);

    await createAttr(as, "  Colour  ", {
      type: "select",
      options: ["  Black  ", "black", "", "  ", "Silver", "SILVER"],
    });
    const [row] = await as.query(api.catalog.attributes.list, {});
    expect(row.name).toBe("Colour");
    expect(row.options).toEqual(["Black", "Silver"]); // first spelling wins, order kept

    await createAttr(as, "Depth", { type: "number", unit: "  mm  " });
    const rows = await as.query(api.catalog.attributes.list, {});
    expect(rows.find((candidate) => candidate.name === "Depth")?.unit).toBe("mm");
  });

  test("shape rules: unit → number, options → select family, select needs choices", async () => {
    const t = setup();
    const as = await ownerTools(t);

    await expect(createAttr(as, "Cable", { type: "text", unit: "kg" })).rejects.toThrow(
      "A unit can only be set on Number attributes.",
    );
    await expect(createAttr(as, "RoHS", { type: "boolean", options: ["Yes"] })).rejects.toThrow(
      "Only Select and Multi-select attributes take options.",
    );
    await expect(createAttr(as, "Color", { type: "select", options: [] })).rejects.toThrow(
      "Select and Multi-select attributes need at least one option.",
    );
    await expect(createAttr(as, "Color", { type: "select", options: ["   ", ""] })).rejects.toThrow(
      "Select and Multi-select attributes need at least one option.",
    );
    await expect(createAttr(as, "   ")).rejects.toThrow(
      "Attribute name must be between 1 and 100 characters.",
    );
    await expect(createAttr(as, "x".repeat(101))).rejects.toThrow(
      "Attribute name must be between 1 and 100 characters.",
    );
    await expect(
      createAttr(as, "Weight", { type: "number", unit: "x".repeat(51) }),
    ).rejects.toThrow("Unit must be 50 characters or fewer.");
    await expect(
      createAttr(as, "Color", { type: "select", options: ["x".repeat(101)] }),
    ).rejects.toThrow("Each option must be 100 characters or fewer.");
    await expect(
      createAttr(as, "Color", {
        type: "select",
        options: Array.from({ length: 101 }, (_, i) => `o${i}`),
      }),
    ).rejects.toThrow("An attribute can have at most 100 options.");

    // Nothing half-written: every rejection above left the table empty.
    expect(await as.query(api.catalog.attributes.list, {})).toEqual([]);
  });

  test("audits creates (entity, action, after snapshot)", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const id = await createAttr(as, "Weight", { type: "number", unit: "kg" });

    const entries = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: "create",
      entity: "attributeDefinitions",
      entityId: id,
      after: { name: "Weight", type: "number", unit: "kg", options: [] },
    });
    expect(entries[0].before).toBeUndefined();
  });

  test("RBAC: strangers refused, warehouse (view-only) can't create", async () => {
    const t = setup();
    await expect(
      t.mutation(api.catalog.attributes.create, { name: "X", type: "text" }),
    ).rejects.toThrow("Not authenticated");

    const warehouse = await roleTools(t, "warehouse@example.com", "warehouse");
    await expect(
      warehouse.mutation(api.catalog.attributes.create, { name: "X", type: "text" }),
    ).rejects.toThrow("You don't have permission to create catalog items.");
    // …but view works.
    expect(await warehouse.query(api.catalog.attributes.list, {})).toEqual([]);
  });
});

describe("attributes:update (PH1-03)", () => {
  test("rename, retype, unit/options swap with before/after audit", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const id = await createAttr(as, "Colour", { type: "select", options: ["Black"] });

    await as.mutation(api.catalog.attributes.update, {
      id,
      name: "Weight",
      type: "number",
      options: [], // full-form: clears the old choices
      unit: "kg",
    });
    const [row] = await as.query(api.catalog.attributes.list, {});
    expect(row).toMatchObject({ name: "Weight", type: "number", unit: "kg", options: [] });

    const entries = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({
      action: "update",
      entity: "attributeDefinitions",
      entityId: id,
      before: { name: "Colour", type: "select", options: ["Black"] },
      after: { name: "Weight", type: "number", unit: "kg", options: [] },
    });
    expect((entries[1].before as { unit?: string }).unit).toBeUndefined();
  });

  test("type change to select requires options; shape rules apply on update too", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const id = await createAttr(as, "Notes", { type: "text" });

    await expect(
      as.mutation(api.catalog.attributes.update, { id, name: "Colour", type: "select" }),
    ).rejects.toThrow("Select and Multi-select attributes need at least one option.");
    await expect(
      as.mutation(api.catalog.attributes.update, {
        id,
        name: "Colour",
        type: "select",
        options: ["Black"],
        unit: "kg",
      }),
    ).rejects.toThrow("A unit can only be set on Number attributes.");

    const [row] = await as.query(api.catalog.attributes.list, {});
    expect(row.name).toBe("Notes"); // rejected writes changed nothing
  });

  test("no-op saves record no audit entry; missing rows error", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const id = await createAttr(as, "Weight", { type: "number", unit: "kg" });

    await as.mutation(api.catalog.attributes.update, {
      id,
      name: "Weight",
      type: "number",
      unit: "kg",
      options: [],
    });
    expect(await t.run((ctx) => ctx.db.query("auditLog").collect())).toHaveLength(1);

    // Delete behind the API's back → update sees a gone row.
    await t.run((ctx) => ctx.db.delete(id));
    await expect(
      as.mutation(api.catalog.attributes.update, { id, name: "X", type: "text" }),
    ).rejects.toThrow("This attribute no longer exists.");
  });

  test("RBAC: sales can edit but warehouse can't", async () => {
    const t = setup();
    const owner = await ownerTools(t);
    const id = await createAttr(owner, "Weight", { type: "number" });

    const sales = await roleTools(t, "sales@example.com", "sales");
    await sales.mutation(api.catalog.attributes.update, {
      id,
      name: "Weight",
      type: "number",
      unit: "kg",
    });
    const row = (await owner.query(api.catalog.attributes.list, {})).find((r) => r._id === id);
    expect(row?.unit).toBe("kg");

    const warehouse = await roleTools(t, "warehouse2@example.com", "warehouse");
    await expect(
      warehouse.mutation(api.catalog.attributes.update, { id, name: "X", type: "text" }),
    ).rejects.toThrow("You don't have permission to edit catalog items.");
  });
});

describe("attributes:remove (PH1-03)", () => {
  test("deletes with an audit snapshot; missing row errors", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const id = await createAttr(as, "Colour", { type: "select", options: ["Black", "Silver"] });

    await as.mutation(api.catalog.attributes.remove, { id });
    expect(await as.query(api.catalog.attributes.list, {})).toEqual([]);

    const entries = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({
      action: "delete",
      entity: "attributeDefinitions",
      entityId: id,
      before: { name: "Colour", type: "select", options: ["Black", "Silver"] },
    });
    expect(entries[1].after).toBeUndefined();

    await expect(as.mutation(api.catalog.attributes.remove, { id })).rejects.toThrow(
      "This attribute no longer exists.",
    );
  });

  test("RBAC: sales notably can't delete (catalog.delete = owner/admin only)", async () => {
    const t = setup();
    const owner = await ownerTools(t);
    const id = await createAttr(owner, "Weight", { type: "number" });

    const sales = await roleTools(t, "sales@example.com", "sales");
    await expect(sales.mutation(api.catalog.attributes.remove, { id })).rejects.toThrow(
      "You don't have permission to delete catalog items.",
    );
    expect(await owner.query(api.catalog.attributes.list, {})).toHaveLength(1);
  });
});

describe("attributes:list (PH1-03)", () => {
  test("strangers refused; empty for a fresh catalog", async () => {
    const t = setup();
    await expect(t.query(api.catalog.attributes.list, {})).rejects.toThrow("Not authenticated");

    const warehouse = await roleTools(t, "warehouse@example.com", "warehouse");
    expect(await warehouse.query(api.catalog.attributes.list, {})).toEqual([]);
  });
});
