import { describe, expect, test } from "vitest";
import { sha256Hex } from "../lib/crypto";
import { api } from "../convex/_generated/api";
import { setup } from "./setup";

/**
 * Invite flow backend (PH0-19): profile creation, code hashing, revocation,
 * and the users list gate.
 *
 * Auth identity: `getAuthUserId` reads `identity.subject` and takes the part
 * before `|`, so a fake identity `${userId}|session` authenticates as that
 * user without needing a real auth session.
 */

async function seedUser(
  t: ReturnType<typeof setup>,
  overrides: Partial<{
    email: string;
    name: string;
    status: "active" | "invited" | "disabled";
  }> = {},
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("users", {
      email: overrides.email ?? "admin@example.com",
      name: overrides.name ?? "Admin",
      status: overrides.status ?? "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}

async function invitesFor(t: ReturnType<typeof setup>, email: string) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("invites")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect(),
  );
}

describe("invites.create (PH0-19)", () => {
  test("creates an invited profile and a hashed, single-use code", async () => {
    const t = setup();
    const inviterId = await seedUser(t);
    const authed = t.withIdentity({ subject: `${inviterId}|session-1` });

    const result = await authed.mutation(api.invites.create, {
      email: "  New@Example.com ", // normalized: trimmed + lowercased
      name: "New Person",
    });

    const user = await t.run(async (ctx) =>
      ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", "new@example.com"))
        .unique(),
    );
    expect(user?.status).toBe("invited");
    expect(user?.name).toBe("New Person");
    expect(user?.invitedBy).toBe(inviterId);
    expect(user?.invitedAt).toBeTypeOf("number");

    // Dev sender (no RESEND_API_KEY): the link is returned for the UI.
    expect(result.sent).toBe(false);
    const link = new URL(result.url!);
    expect(link.pathname).toBe("/invite");
    expect(link.searchParams.get("email")).toBe("new@example.com");
    const code = link.searchParams.get("code");
    expect(code).toMatch(/^[0-9a-f]{64}$/);

    // The raw code is never stored — only its SHA-256.
    const invites = await invitesFor(t, "new@example.com");
    expect(invites).toHaveLength(1);
    expect(invites[0].codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256Hex(code!)).toBe(invites[0].codeHash);
    expect(invites[0].expiresAt).toBeGreaterThan(Date.now());
  });

  test("requires an authenticated inviter", async () => {
    const t = setup();
    await expect(t.mutation(api.invites.create, { email: "x@example.com" })).rejects.toThrow(
      "Not authenticated",
    );
  });

  test("rejects invalid input and non-invitable users", async () => {
    const t = setup();
    const inviterId = await seedUser(t);
    const authed = t.withIdentity({ subject: `${inviterId}|session-1` });

    await expect(authed.mutation(api.invites.create, { email: "not-an-email" })).rejects.toThrow(
      "Enter a valid email address",
    );
    await expect(
      authed.mutation(api.invites.create, { email: "admin@example.com" }),
    ).rejects.toThrow("already a member");
    await expect(
      authed.mutation(api.invites.create, { email: "staff@example.com", name: "x".repeat(101) }),
    ).rejects.toThrow("between 1 and 100 characters");

    await seedUser(t, { email: "off@example.com", status: "disabled" });
    await expect(authed.mutation(api.invites.create, { email: "off@example.com" })).rejects.toThrow(
      "disabled",
    );
  });

  test("re-inviting revokes the previous code", async () => {
    const t = setup();
    const inviterId = await seedUser(t);
    const authed = t.withIdentity({ subject: `${inviterId}|session-1` });

    const first = await authed.mutation(api.invites.create, { email: "again@example.com" });
    const second = await authed.mutation(api.invites.create, { email: "again@example.com" });

    const invites = await invitesFor(t, "again@example.com");
    expect(invites).toHaveLength(2);
    const codeOf = (url: string) => new URL(url).searchParams.get("code")!;
    const [oldInvite, newInvite] = invites;
    // Only the newest link stays usable.
    expect(oldInvite.revokedAt).toBeTypeOf("number");
    expect(newInvite.revokedAt).toBeUndefined();
    expect(await sha256Hex(codeOf(first.url!))).toBe(oldInvite.codeHash);
    expect(await sha256Hex(codeOf(second.url!))).toBe(newInvite.codeHash);
    // Re-invite keeps one profile — no duplicates.
    const users = await t.run(async (ctx) =>
      ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", "again@example.com"))
        .collect(),
    );
    expect(users).toHaveLength(1);
  });
});

describe("users.list (PH0-19)", () => {
  test("requires authentication and pages newest-first", async () => {
    const t = setup();
    await expect(
      t.query(api.users.list, { paginationOpts: { numItems: 10, cursor: null } }),
    ).rejects.toThrow("Not authenticated");

    const first = await seedUser(t, { email: "first@example.com" });
    const second = await seedUser(t, { email: "second@example.com" });
    const authed = t.withIdentity({ subject: `${first}|session-1` });

    const page = await authed.query(api.users.list, {
      paginationOpts: { numItems: 1, cursor: null },
    });
    expect(page.page.map((u) => u._id)).toEqual([second]);
    expect(page.isDone).toBe(false);

    const next = await authed.query(api.users.list, {
      paginationOpts: { numItems: 10, cursor: page.continueCursor },
    });
    expect(next.page.map((u) => u._id)).toEqual([first]);
    expect(next.isDone).toBe(true);
  });
});
