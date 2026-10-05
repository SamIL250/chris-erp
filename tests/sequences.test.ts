import { describe, expect, test } from "vitest";
import {
  DEFAULT_SEQUENCES,
  ensureDefaultSequences,
  formatSequence,
  nextSequence,
  peekSequence,
} from "../convex/_lib/sequences";
import { setup } from "./setup";

/**
 * Document numbering (PH0-25): formatted numbers, monotonic consumption,
 * idempotent seeding, and helpful failure for unknown sequences.
 */

async function seedSequence(
  t: ReturnType<typeof setup>,
  overrides: { name?: string; prefix?: string; next?: number; padding?: number } = {},
) {
  return await t.run((ctx) =>
    ctx.db.insert("sequences", {
      name: overrides.name ?? "invoice",
      prefix: overrides.prefix ?? "INV-",
      next: overrides.next ?? 1,
      padding: overrides.padding ?? 4,
      updatedAt: Date.now(),
    }),
  );
}

describe("nextSequence (PH0-25)", () => {
  test("formats, consumes, and increments monotonically", async () => {
    const t = setup();
    await seedSequence(t);

    expect(await t.run((ctx) => nextSequence(ctx, "invoice"))).toBe("INV-0001");
    expect(await t.run((ctx) => nextSequence(ctx, "invoice"))).toBe("INV-0002");

    const row = await t.run((ctx) => ctx.db.query("sequences").collect());
    expect(row).toHaveLength(1);
    expect(row[0].next).toBe(3);
  });

  test("respects custom prefix and padding", async () => {
    const t = setup();
    await seedSequence(t, { name: "journal", prefix: "JRNL-", next: 98, padding: 6 });

    expect(await t.run((ctx) => nextSequence(ctx, "journal"))).toBe("JRNL-000098");
    expect(await t.run((ctx) => nextSequence(ctx, "journal"))).toBe("JRNL-000099");
    // Beyond padding: no truncation, just no zero-fill.
    await t.run(async (ctx) => {
      const seq = await ctx.db.query("sequences").collect();
      await ctx.db.patch(seq[0]._id, { next: 999999 });
    });
    expect(await t.run((ctx) => nextSequence(ctx, "journal"))).toBe("JRNL-999999");
  });

  test("unknown sequence names fail with a helpful message", async () => {
    const t = setup();
    await expect(t.run((ctx) => nextSequence(ctx, "nonexistent"))).rejects.toThrow(
      'No document sequence named "nonexistent"',
    );
  });

  test("peekSequence previews without consuming", async () => {
    const t = setup();
    await seedSequence(t);

    expect(await t.run((ctx) => peekSequence(ctx, "invoice"))).toBe("INV-0001");
    expect(await t.run((ctx) => peekSequence(ctx, "invoice"))).toBe("INV-0001");
    expect(await t.run((ctx) => nextSequence(ctx, "invoice"))).toBe("INV-0001");
    expect(await t.run((ctx) => peekSequence(ctx, "invoice"))).toBe("INV-0002");
  });

  test("formatSequence is a pure formatter", () => {
    expect(formatSequence({ prefix: "SO-", next: 42, padding: 5 })).toBe("SO-00042");
    expect(formatSequence({ prefix: "RMA-", next: 7, padding: 0 })).toBe("RMA-7");
  });

  test("ensureDefaultSequences seeds the canonical list idempotently", async () => {
    const t = setup();
    // A pre-existing, customized invoice row must never be overwritten.
    await seedSequence(t, { name: "invoice", prefix: "FA-", padding: 5 });
    await t.run((ctx) => ensureDefaultSequences(ctx));
    await t.run((ctx) => ensureDefaultSequences(ctx));

    const rows = await t.run((ctx) => ctx.db.query("sequences").collect());
    // All canonical names present — the pre-existing invoice row replaced its slot.
    expect(rows).toHaveLength(DEFAULT_SEQUENCES.length);
    const invoice = rows.filter((row) => row.name === "invoice");
    expect(invoice).toHaveLength(1);
    expect(invoice[0].prefix).toBe("FA-");
    expect(invoice[0].next).toBe(1); // untouched — custom row wins
    for (const entry of DEFAULT_SEQUENCES) {
      const row = rows.find((candidate) => candidate.name === entry.name);
      expect(row).toBeDefined();
      if (entry.name !== "invoice") expect(row?.prefix).toBe(entry.prefix);
    }
  });
});
