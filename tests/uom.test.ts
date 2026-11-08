import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  conversionFactors,
  convertQuantity,
  MAX_CONVERSION_FACTOR,
  MAX_CONVERSIONS,
  normalizeUoMCode,
  uomCodeError,
  validateConversions,
  validateDocUoM,
} from "../lib/uom";
import { setup } from "./setup";

/**
 * Units of measure + pack-size conversions (PH1-11): codes normalize once
 * (trim+lowercase), chains of `1 unit = factor × parent` must terminate at
 * the product's base UoM, and doc-level purchase/sales UoMs must be
 * reachable through that chain. `lib/uom` is the single source of truth —
 * the editor's build gate and the mutation both call it, so every message
 * asserted here is byte-identical on both sides.
 *
 * The conversion diff is an ORDER-INSENSITIVE key set: re-saving rows in a
 * different order is still a no-op (no audit entry), while any real change
 * lands in the audit snapshot alongside the doc-level UoMs.
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

function fullArgs(over: Record<string, unknown> = {}) {
  return {
    name: "Bench Centrifuge C2",
    sku: "UOM-1001",
    status: "active" as const,
    serialTracked: false,
    lotTracked: false,
    expiryRequired: false,
    warrantyEligible: false,
    allowBackorder: false,
    images: [] as { fileId: Id<"files">; alt?: string }[],
    categoryIds: [] as Id<"categories">[],
    attributeSetIds: [] as Id<"attributeSets">[],
    ...over,
  };
}

async function auditRows(t: T) {
  const rows = await t.run((ctx) => ctx.db.query("auditLog").collect());
  return rows.filter((row) => row.entity === "products");
}

/* ------------------------------------------------------------ code rules */

describe("UoM codes (lib/uom)", () => {
  test("normalize is trim + lowercase and idempotent", () => {
    expect(normalizeUoMCode(" Box ")).toBe("box");
    expect(normalizeUoMCode("EACH")).toBe("each");
    expect(normalizeUoMCode(normalizeUoMCode(" Case-Pack "))).toBe("case-pack");
  });

  test("format accepts the vocabulary and rejects length/charset", () => {
    expect(uomCodeError("each", "Unit of measure")).toBeNull();
    expect(uomCodeError("case-pack", "Unit of measure")).toBeNull();
    expect(uomCodeError("m3", "Unit of measure")).toBeNull();
    expect(uomCodeError("", "Unit of measure")).toBe("Unit of measure can't be empty.");
    expect(uomCodeError("a".repeat(17), "Unit of measure")).toBe(
      "Unit of measure must be 16 characters or fewer.",
    );
    expect(uomCodeError("per hour", "Unit of measure")).toBe(
      'Unit of measure must be letters/digits with "." or "-" separators (e.g. "each", "box").',
    );
    expect(uomCodeError("box!", "Purchase UoM")).toContain("Purchase UoM");
  });
});

/* ----------------------------------------------------- conversion chains */

describe("validateConversions (lib/uom)", () => {
  test("valid chain: normalizes codes and returns rows in input order", () => {
    const result = validateConversions(" Each ", [
      { unit: " Box", parent: "Each", factor: 12 },
      { unit: "case", parent: "box", factor: 6 },
    ]);
    expect(result.error).toBeNull();
    expect(result.rows).toEqual([
      { unit: "box", parent: "each", factor: 12 },
      { unit: "case", parent: "box", factor: 6 },
    ]);
  });

  test("no rows is valid with or without a base", () => {
    expect(validateConversions("", [])).toEqual({ rows: [], error: null });
    expect(validateConversions("each", [])).toEqual({ rows: [], error: null });
  });

  test("rows need a base first", () => {
    expect(validateConversions("", [{ unit: "box", parent: "each", factor: 12 }]).error).toBe(
      "Set the base unit of measure before adding conversions.",
    );
  });

  test("a chain that loops back is rejected", () => {
    const result = validateConversions("each", [
      { unit: "box", parent: "case", factor: 2 },
      { unit: "case", parent: "box", factor: 3 },
    ]);
    expect(result.error).toBe('Conversion chain loops back to "box".');
  });

  test("a parent that is neither base nor another row dangles", () => {
    expect(validateConversions("each", [{ unit: "case", parent: "pallet", factor: 4 }]).error).toBe(
      'Conversion for "case" references "pallet", which is neither the base unit nor another conversion.',
    );
  });

  test("duplicate units, self-conversion, and unit = base are rejected", () => {
    expect(
      validateConversions("each", [
        { unit: "box", parent: "each", factor: 12 },
        { unit: "BOX", parent: "case", factor: 2 },
      ]).error,
    ).toBe('Duplicate conversion for "box".');
    expect(validateConversions("each", [{ unit: "box", parent: "box", factor: 12 }]).error).toBe(
      'Conversion unit "box" can\'t convert to itself.',
    );
    expect(validateConversions("each", [{ unit: "each", parent: "box", factor: 12 }]).error).toBe(
      'Conversion unit "each" is already the base unit.',
    );
  });

  test("factors must be finite, > 0, and within the typo guard", () => {
    expect(validateConversions("each", [{ unit: "box", parent: "each", factor: 0 }]).error).toBe(
      'Conversion factor for "box" must be greater than 0.',
    );
    expect(
      validateConversions("each", [{ unit: "box", parent: "each", factor: Number.NaN }]).error,
    ).toBe('Conversion factor for "box" must be greater than 0.');
    expect(
      validateConversions("each", [
        { unit: "box", parent: "each", factor: MAX_CONVERSION_FACTOR + 1 },
      ]).error,
    ).toBe(`Conversion factor for "box" must be ${MAX_CONVERSION_FACTOR} or fewer.`);
  });

  test("code format errors surface with their field label", () => {
    expect(
      validateConversions("each", [{ unit: "per hour", parent: "each", factor: 2 }]).error,
    ).toContain("Conversion unit");
    expect(
      validateConversions("each", [{ unit: "box", parent: "each unit", factor: 2 }]).error,
    ).toContain("Conversion parent");
  });

  test("row count is capped", () => {
    const rows = Array.from({ length: MAX_CONVERSIONS + 1 }, (_, index) => ({
      unit: `p${index}`,
      parent: "each",
      factor: 2,
    }));
    expect(validateConversions("each", rows).error).toBe(
      `Add at most ${MAX_CONVERSIONS} conversions per product.`,
    );
  });
});

/* -------------------------------------------------------- math + doc UoM */

describe("conversion math (lib/uom)", () => {
  const base = "each";
  const rows = validateConversions(base, [
    { unit: "box", parent: "each", factor: 12 },
    { unit: "case", parent: "box", factor: 6 },
  ]).rows!;

  test("factors compose to the base (box = 12, case = 72)", () => {
    const factors = conversionFactors(base, rows);
    expect(factors.get("each")).toBe(1);
    expect(factors.get("box")).toBe(12);
    expect(factors.get("case")).toBe(72);
  });

  test("convertQuantity walks through the base in both directions", () => {
    expect(convertQuantity(2, "case", "box", base, rows)).toBe(12);
    expect(convertQuantity(144, "each", "case", base, rows)).toBe(2);
    expect(convertQuantity(5, "box", "box", base, rows)).toBe(5);
    expect(convertQuantity(5, "pallet", "box", base, rows)).toBeNull();
  });
});

describe("validateDocUoM (lib/uom)", () => {
  const rows = validateConversions("each", [
    { unit: "box", parent: "each", factor: 12 },
    { unit: "case", parent: "box", factor: 6 },
  ]).rows!;

  test("unset stays unset", () => {
    expect(validateDocUoM("Sales UoM", undefined, "each", rows)).toEqual({
      code: null,
      error: null,
    });
    expect(validateDocUoM("Sales UoM", "   ", "each", rows)).toEqual({
      code: null,
      error: null,
    });
  });

  test("accepts the base and any conversion unit, normalized", () => {
    expect(validateDocUoM("Sales UoM", " Each ", "each", rows)).toEqual({
      code: "each",
      error: null,
    });
    expect(validateDocUoM("Purchase UoM", "CASE", "each", rows)).toEqual({
      code: "case",
      error: null,
    });
  });

  test("rejects unreachable and malformed codes with named messages", () => {
    expect(validateDocUoM("Purchase UoM", "pallet", "each", rows).error).toBe(
      'Purchase UoM "pallet" must be the base unit or one of this product\'s conversions.',
    );
    expect(validateDocUoM("Sales UoM", "box", "", []).error).toBe(
      'Sales UoM "box" needs the base unit of measure set first.',
    );
    expect(validateDocUoM("Purchase UoM", "per hour", "each", rows).error).toContain(
      "Purchase UoM must be letters/digits",
    );
  });
});

/* ---------------------------------------------------------- mutations */

describe("products:create UoM (PH1-11)", () => {
  test("round-trips codes (normalized), conversions, and doc-level UoM", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const { id } = await as.mutation(
      api.catalog.products.create,
      fullArgs({
        unitOfMeasure: " Each ",
        conversions: [
          { unit: " Box ", parent: "Each", factor: 12 },
          { unit: "case", parent: "box", factor: 6 },
        ],
        purchaseUoM: " Case ",
        salesUoM: "BOX",
      }),
    );
    const row = (await as.query(api.catalog.products.get, { id }))?.product;
    expect(row?.unitOfMeasure).toBe("each");
    expect(row?.conversions).toEqual([
      { unit: "box", parent: "each", factor: 12 },
      { unit: "case", parent: "box", factor: 6 },
    ]);
    expect(row?.purchaseUoM).toBe("case");
    expect(row?.salesUoM).toBe("box");
    const audit = await auditRows(t);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.after).toMatchObject({
      unitOfMeasure: "each",
      conversions: [
        { unit: "box", parent: "each", factor: 12 },
        { unit: "case", parent: "box", factor: 6 },
      ],
      purchaseUoM: "case",
      salesUoM: "box",
    });
  });

  test("guards surface the shared lib/uom messages verbatim", async () => {
    const t = setup();
    const as = await ownerTools(t);
    await expect(
      as.mutation(
        api.catalog.products.create,
        fullArgs({ sku: "UOM-1002", unitOfMeasure: "per hour" }),
      ),
    ).rejects.toThrow(
      'Unit of measure must be letters/digits with "." or "-" separators (e.g. "each", "box").',
    );
    await expect(
      as.mutation(
        api.catalog.products.create,
        fullArgs({ sku: "UOM-1003", conversions: [{ unit: "box", parent: "each", factor: 12 }] }),
      ),
    ).rejects.toThrow("Set the base unit of measure before adding conversions.");
    await expect(
      as.mutation(
        api.catalog.products.create,
        fullArgs({
          sku: "UOM-1004",
          unitOfMeasure: "each",
          conversions: [
            { unit: "box", parent: "case", factor: 2 },
            { unit: "case", parent: "box", factor: 3 },
          ],
        }),
      ),
    ).rejects.toThrow('Conversion chain loops back to "box".');
    await expect(
      as.mutation(
        api.catalog.products.create,
        fullArgs({
          sku: "UOM-1005",
          unitOfMeasure: "each",
          conversions: [{ unit: "box", parent: "each", factor: 0 }],
        }),
      ),
    ).rejects.toThrow('Conversion factor for "box" must be greater than 0.');
    await expect(
      as.mutation(
        api.catalog.products.create,
        fullArgs({ sku: "UOM-1006", unitOfMeasure: "each", purchaseUoM: "pallet" }),
      ),
    ).rejects.toThrow(
      'Purchase UoM "pallet" must be the base unit or one of this product\'s conversions.',
    );
    await expect(
      as.mutation(api.catalog.products.create, fullArgs({ sku: "UOM-1007", salesUoM: "box" })),
    ).rejects.toThrow('Sales UoM "box" needs the base unit of measure set first.');
    expect(await auditRows(t)).toHaveLength(0); // rejected writes never audit
  });
});

describe("products:update UoM (PH1-11)", () => {
  test("reordering conversion rows is a no-op; real changes are audited", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const base = fullArgs({
      unitOfMeasure: "each",
      conversions: [
        { unit: "box", parent: "each", factor: 12 },
        { unit: "case", parent: "box", factor: 6 },
      ],
      purchaseUoM: "case",
      salesUoM: "box",
    });
    const { id } = await as.mutation(api.catalog.products.create, base);
    expect(await auditRows(t)).toHaveLength(1);

    // Same rows, reversed — order-insensitive keys mean no audit entry.
    await as.mutation(api.catalog.products.update, {
      ...base,
      id,
      conversions: [
        { unit: "case", parent: "box", factor: 6 },
        { unit: "box", parent: "each", factor: 12 },
      ],
    });
    expect(await auditRows(t)).toHaveLength(1);

    // A real edit (factor) lands with the full UoM snapshot.
    await as.mutation(api.catalog.products.update, {
      ...base,
      id,
      conversions: [
        { unit: "box", parent: "each", factor: 24 },
        { unit: "case", parent: "box", factor: 6 },
      ],
      purchaseUoM: "each",
      salesUoM: "case",
    });
    const audit = await auditRows(t);
    expect(audit).toHaveLength(2);
    expect(audit[1]?.before).toMatchObject({
      unitOfMeasure: "each",
      purchaseUoM: "case",
      salesUoM: "box",
    });
    expect(audit[1]?.after).toMatchObject({
      conversions: [
        { unit: "box", parent: "each", factor: 24 },
        { unit: "case", parent: "box", factor: 6 },
      ],
      purchaseUoM: "each",
      salesUoM: "case",
    });
  });

  test("omitted optionals clear (full-form contract) and persist as empty", async () => {
    const t = setup();
    const as = await ownerTools(t);
    const { id } = await as.mutation(
      api.catalog.products.create,
      fullArgs({
        unitOfMeasure: "each",
        conversions: [{ unit: "box", parent: "each", factor: 12 }],
        purchaseUoM: "box",
        salesUoM: "box",
      }),
    );
    await as.mutation(api.catalog.products.update, {
      ...fullArgs({ unitOfMeasure: undefined, conversions: undefined }),
      id,
    });
    const row = (await as.query(api.catalog.products.get, { id }))?.product;
    expect(row?.unitOfMeasure).toBeUndefined();
    expect(row?.conversions).toEqual([]);
    expect(row?.purchaseUoM).toBeUndefined();
    expect(row?.salesUoM).toBeUndefined();
  });
});
