import { describe, expect, test } from "vitest";
import {
  LOT_STATUSES,
  LOT_TRANSITIONS,
  lotBlocksSale,
  lotDateError,
  lotNumberError,
  lotSupplierError,
  lotTransitionError,
  effectiveLotStatus,
  normalizeLotNumber,
  normalizeLotSupplier,
} from "../lib/lots";
import {
  SERIAL_STATUSES,
  SERIAL_TRANSITIONS,
  normalizeSerialNumber,
  serialNumberError,
  serialTransitionError,
  warrantyLookup,
} from "../lib/serials";
import { setup } from "./setup";

/**
 * PH1-14 — serial and lot schema plus the helper skeleton. No mutations:
 * Phase 5 owns receipt, pick, and recall. These tests lock the state
 * machines, the date and warranty rules, and that the tables accept a
 * master row and answer their indexes.
 */

const DAY = 24 * 60 * 60 * 1000;

describe("serial state machine (PH1-14)", () => {
  test("every status has an entry, and disabled is terminal", () => {
    for (const status of SERIAL_STATUSES) {
      expect(SERIAL_TRANSITIONS[status]).toBeDefined();
    }
    expect(SERIAL_TRANSITIONS.disabled).toEqual([]);
  });

  test("the lifecycle edges are legal and the reverse of a shipment is not", () => {
    expect(serialTransitionError("available", "reserved")).toBeNull();
    expect(serialTransitionError("reserved", "shipped")).toBeNull();
    expect(serialTransitionError("shipped", "returned")).toBeNull();
    expect(serialTransitionError("returned", "service")).toBeNull();
    expect(serialTransitionError("service", "available")).toBeNull();
    expect(serialTransitionError("service", "shipped")).toBeNull();
    expect(serialTransitionError("reserved", "available")).toBeNull();
    expect(serialTransitionError("returned", "available")).toBeNull();
    expect(serialTransitionError("available", "disabled")).toBeNull();
    // Same state is a no-op, not a rejection.
    expect(serialTransitionError("shipped", "shipped")).toBeNull();
  });

  test("illegal jumps name both sides", () => {
    expect(serialTransitionError("available", "shipped")).toBe(
      "A serial can't move from available to shipped.",
    );
    expect(serialTransitionError("shipped", "available")).toBe(
      "A serial can't move from shipped to available.",
    );
    expect(serialTransitionError("disabled", "available")).toBe(
      "A serial can't move from disabled to available.",
    );
  });

  test("serial numbers trim and keep case", () => {
    expect(normalizeSerialNumber("  Ab-9  ")).toBe("Ab-9");
    expect(serialNumberError("   ")).toBe("Serial number can't be empty.");
    expect(serialNumberError("x".repeat(65))).toBe("Serial number must be 64 characters or fewer.");
    expect(serialNumberError("SN-1")).toBeNull();
  });
});

describe("warranty lookup (PH1-14)", () => {
  const start = Date.UTC(2024, 0, 31, 15, 0, 0);

  test("unregistered units are none", () => {
    expect(warrantyLookup({ now: start })).toEqual({
      status: "none",
      endsAt: null,
      remainingMonths: null,
    });
    expect(warrantyLookup({ warrantyStart: start, warrantyMonths: 0, now: start }).status).toBe(
      "none",
    );
  });

  test("a 24-month term sold 31 Jan ends 31 Jan two years later", () => {
    const atStart = warrantyLookup({ warrantyStart: start, warrantyMonths: 24, now: start });
    expect(atStart.status).toBe("valid");
    expect(atStart.endsAt).toBe(Date.UTC(2026, 0, 31, 15, 0, 0));
    expect(atStart.remainingMonths).toBe(24);

    const almostDue = warrantyLookup({
      warrantyStart: start,
      warrantyMonths: 24,
      now: Date.UTC(2026, 0, 31, 14, 59, 0),
    });
    expect(almostDue.status).toBe("valid");
    expect(almostDue.remainingMonths).toBe(0);

    const due = warrantyLookup({
      warrantyStart: start,
      warrantyMonths: 24,
      now: Date.UTC(2026, 0, 31, 15, 0, 0),
    });
    expect(due.status).toBe("expired");
    expect(due.remainingMonths).toBe(0);
  });
});

describe("lot disposition (PH1-14)", () => {
  test("every status has an entry, and recall and expiry stick", () => {
    for (const status of LOT_STATUSES) {
      expect(LOT_TRANSITIONS[status]).toBeDefined();
    }
    expect(LOT_TRANSITIONS.recalled).toEqual([]);
    expect(LOT_TRANSITIONS.expired).toEqual([]);
  });

  test("inspection can release a quarantine; a recall cannot be undone", () => {
    expect(lotTransitionError("released", "quarantined")).toBeNull();
    expect(lotTransitionError("quarantined", "released")).toBeNull();
    expect(lotTransitionError("quarantined", "recalled")).toBeNull();
    expect(lotTransitionError("released", "expired")).toBeNull();
    expect(lotTransitionError("recalled", "released")).toBe(
      "A lot can't move from recalled to released.",
    );
    expect(lotTransitionError("expired", "released")).toBe(
      "A lot can't move from expired to released.",
    );
    expect(lotTransitionError("released", "released")).toBeNull();
  });

  test("lot numbers and supplier labels", () => {
    expect(normalizeLotNumber("  L-1  ")).toBe("L-1");
    expect(lotNumberError("")).toBe("Lot number can't be empty.");
    expect(normalizeLotSupplier("  Acme  ")).toBe("Acme");
    expect(normalizeLotSupplier("   ")).toBeUndefined();
    expect(lotSupplierError(undefined)).toBeNull();
    expect(lotSupplierError("   ")).toBe("Supplier can't be blank — leave it empty instead.");
  });

  test("date order, and expiry required only when the product says so", () => {
    const received = 1_000;
    expect(
      lotDateError({
        receivedDate: received,
        mfgDate: 900,
        expiryDate: 2_000,
        expiryRequired: true,
      }),
    ).toBeNull();
    expect(lotDateError({ receivedDate: received, expiryRequired: true })).toBe(
      "Expiry date is required when the product requires expiry.",
    );
    expect(lotDateError({ receivedDate: received, expiryRequired: false })).toBeNull();
    expect(
      lotDateError({ receivedDate: received, mfgDate: received + DAY, expiryRequired: false }),
    ).toBe("Manufacturing date can't be after the received date.");
    expect(
      lotDateError({
        receivedDate: received,
        mfgDate: 500,
        expiryDate: 400,
        expiryRequired: false,
      }),
    ).toBe("Expiry date can't be before the manufacturing date.");
    expect(lotDateError({ receivedDate: Number.NaN, expiryRequired: false })).toBe(
      "Received date must be a real date.",
    );
  });

  test("a passed expiry blocks a sale; quarantine and recall outrank the date", () => {
    const now = 1_000;
    expect(effectiveLotStatus("released", 1_000, now)).toBe("expired");
    expect(effectiveLotStatus("released", 1_001, now)).toBe("released");
    expect(effectiveLotStatus("released", undefined, now)).toBe("released");
    expect(effectiveLotStatus("recalled", 1, now)).toBe("recalled");
    expect(effectiveLotStatus("quarantined", 1, now)).toBe("quarantined");
    expect(lotBlocksSale("released", 1_001, now)).toBe(false);
    expect(lotBlocksSale("released", 1_000, now)).toBe(true);
    expect(lotBlocksSale("quarantined", undefined, now)).toBe(true);
    expect(lotBlocksSale("expired", undefined, now)).toBe(true);
  });
});

describe("serials and lots tables (PH1-14)", () => {
  test("a serial and a lot round-trip through their indexes", async () => {
    const t = setup();
    const ids = await t.run(async (ctx) => {
      const productId = await ctx.db.insert("products", {
        name: "Gel",
        slug: "gel",
        sku: "GEL-1",
        status: "active",
        categoryIds: [],
        createdAt: 1,
        updatedAt: 1,
      });
      const variantId = await ctx.db.insert("variants", {
        productId,
        optionValues: [],
        sku: "GEL-1-BULK",
        createdAt: 1,
        updatedAt: 1,
      });
      const serialId = await ctx.db.insert("serials", {
        productId,
        variantId,
        number: "SN-100",
        status: "available",
        warrantyMonths: 24,
        createdAt: 1,
        updatedAt: 1,
      });
      const lotId = await ctx.db.insert("lots", {
        productId,
        number: "LOT-9",
        supplier: "Acme",
        receivedDate: 500,
        mfgDate: 400,
        expiryDate: 9_000,
        status: "released",
        createdAt: 1,
        updatedAt: 1,
      });
      // A lot with no expiry still indexes, under the null key.
      await ctx.db.insert("lots", {
        productId,
        number: "LOT-OPEN",
        receivedDate: 500,
        status: "quarantined",
        createdAt: 1,
        updatedAt: 1,
      });
      return { productId, serialId, lotId };
    });

    await t.run(async (ctx) => {
      const byNumber = await ctx.db
        .query("serials")
        .withIndex("by_number", (q) => q.eq("number", "SN-100"))
        .unique();
      expect(byNumber?._id).toBe(ids.serialId);
      expect(byNumber?.status).toBe("available");

      const available = await ctx.db
        .query("serials")
        .withIndex("by_product_status", (q) =>
          q.eq("productId", ids.productId).eq("status", "available"),
        )
        .collect();
      expect(available.map((row) => row._id)).toEqual([ids.serialId]);

      const byLot = await ctx.db
        .query("lots")
        .withIndex("by_product_number", (q) =>
          q.eq("productId", ids.productId).eq("number", "LOT-9"),
        )
        .unique();
      expect(byLot?._id).toBe(ids.lotId);
      expect(byLot?.supplier).toBe("Acme");

      const byExpiry = await ctx.db
        .query("lots")
        .withIndex("by_product_expiry", (q) => q.eq("productId", ids.productId))
        .collect();
      // Null expiry sorts before real dates.
      expect(byExpiry.map((row) => row.number)).toEqual(["LOT-OPEN", "LOT-9"]);
    });
  });
});
