import { describe, expect, test } from "vitest";
import {
  DEFAULT_SEQUENCES,
  ensureDefaultSequences,
  formatSequence,
  nextSequence,
  peekSequence,
} from "../convex/_lib/sequences";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
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

/**
 * Numbering settings API (PH0-30): settings.view to read, settings.edit to
 * initialize/edit (audited), canonical ordering, and validation.
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

describe("sequences settings API (PH0-30)", () => {
  test("list needs settings.view and keeps canonical order", async () => {
    const t = setup();
    const owner = await seedUser(t, "owner@example.com");
    const sales = await seedUser(t, "sales@example.com");
    const accountant = await seedUser(t, "accountant@example.com");
    await grant(t, owner, "owner");
    await grant(t, sales, "sales");
    await grant(t, accountant, "accountant");

    const denied = "You don't have permission to view settings items.";
    await expect(t.query(api.sequences.list, {})).rejects.toThrow("Not authenticated");
    await expect(
      t.withIdentity({ subject: `${sales}|session-1` }).query(api.sequences.list, {}),
    ).rejects.toThrow(denied);

    // Insert out of order — list still returns canonical ordering.
    await seedSequence(t, { name: "invoice" });
    await seedSequence(t, { name: "quote" });
    await seedSequence(t, { name: "workOrder" });
    const rows = await t
      .withIdentity({ subject: `${accountant}|session-1` })
      .query(api.sequences.list, {});
    expect(rows.map((row) => row.name)).toEqual(["quote", "invoice", "workOrder"]);
  });

  test("ensureDefaults: settings.edit, idempotent, never overwrites customs", async () => {
    const t = setup();
    const owner = await seedUser(t, "owner@example.com");
    const accountant = await seedUser(t, "accountant@example.com");
    await grant(t, owner, "owner");
    await grant(t, accountant, "accountant");

    const denied = "You don't have permission to create settings items.";
    await expect(
      t
        .withIdentity({ subject: `${accountant}|session-1` })
        .mutation(api.sequences.ensureDefaults, {}),
    ).rejects.toThrow(denied);

    const asOwner = t.withIdentity({ subject: `${owner}|session-1` });
    await seedSequence(t, { name: "invoice", prefix: "FA-", padding: 5 });
    await asOwner.mutation(api.sequences.ensureDefaults, {});
    await asOwner.mutation(api.sequences.ensureDefaults, {});

    const rows = await t.run((ctx) => ctx.db.query("sequences").collect());
    expect(rows).toHaveLength(DEFAULT_SEQUENCES.length);
    expect(rows.find((row) => row.name === "invoice")?.prefix).toBe("FA-");

    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    // First call created 10 rows and was audited; the idempotent re-run wasn't.
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "create",
      entity: "sequences",
      actorLabel: "owner@example.com",
      after: { created: 10, total: DEFAULT_SEQUENCES.length },
    });
  });

  test("update: settings.edit, validates, audited, no-op not audited", async () => {
    const t = setup();
    const owner = await seedUser(t, "owner@example.com");
    const accountant = await seedUser(t, "accountant@example.com");
    await grant(t, owner, "owner");
    await grant(t, accountant, "accountant");
    const seqId = await seedSequence(t, { name: "invoice", prefix: "INV-", next: 42 });

    const denied = "You don't have permission to edit settings items.";
    await expect(
      t
        .withIdentity({ subject: `${accountant}|session-1` })
        .mutation(api.sequences.update, { id: seqId, prefix: "X-", padding: 4 }),
    ).rejects.toThrow(denied);

    const asOwner = t.withIdentity({ subject: `${owner}|session-1` });
    await expect(
      asOwner.mutation(api.sequences.update, { id: seqId, prefix: "no spaces", padding: 4 }),
    ).rejects.toThrow("1-10 characters");
    await expect(
      asOwner.mutation(api.sequences.update, { id: seqId, prefix: "inv", padding: 0 }),
    ).rejects.toThrow("between 1 and 6");
    expect(await t.run((ctx) => ctx.db.query("auditLog").collect())).toHaveLength(0);

    // Lower-case input is uppercased; preview reads INV-000042 next.
    await asOwner.mutation(api.sequences.update, { id: seqId, prefix: "inv-", padding: 6 });
    const row = await t.run((ctx) => ctx.db.get(seqId));
    expect(row).toMatchObject({ prefix: "INV-", padding: 6, next: 42 });
    expect(formatSequence(row!)).toBe("INV-000042");

    const audit = await t.run((ctx) => ctx.db.query("auditLog").collect());
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "update",
      entity: "sequences",
      entityId: seqId,
      before: { prefix: "INV-", padding: 4 },
      after: { prefix: "INV-", padding: 6 },
    });

    // Saving the same values changes nothing and records nothing.
    await asOwner.mutation(api.sequences.update, { id: seqId, prefix: "inv-", padding: 6 });
    expect(await t.run((ctx) => ctx.db.query("auditLog").collect())).toHaveLength(1);
  });
});
