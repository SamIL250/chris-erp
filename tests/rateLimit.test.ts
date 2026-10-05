import { describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { setup } from "./setup";

/**
 * Auth hardening (PH0-20): built-in rate limiting + session revocation.
 *
 * Both go through the library's `auth:store` dispatcher / our action, i.e.
 * the same code paths production traffic uses — rate limiting runs inside
 * those mutations, so calling the deployment directly cannot bypass it.
 */

async function seedUserAndAccount(t: ReturnType<typeof setup>, email: string, secret: string) {
  await t.mutation(internal.auth.store, {
    args: {
      type: "createAccountFromCredentials",
      provider: "password",
      account: { id: email, secret },
      profile: { email, name: "Victim" },
    },
  });
  const user = await t.run(async (ctx) =>
    ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .unique(),
  );
  if (user === null) throw new Error("seed failed");
  return user._id;
}

function attemptSignIn(t: ReturnType<typeof setup>, email: string, secret: string) {
  return t.mutation(internal.auth.store, {
    args: {
      type: "retrieveAccountWithCredentials",
      provider: "password",
      account: { id: email, secret },
    },
  });
}

describe("auth rate limiting (PH0-20)", () => {
  test("locks the account after 10 failed password attempts", async () => {
    const t = setup();
    await seedUserAndAccount(t, "victim@example.com", "correct-horse-battery");

    // Sanity: the right password works before any failures.
    expect(await attemptSignIn(t, "victim@example.com", "correct-horse-battery")).toMatchObject({
      account: expect.anything(),
    });

    for (let i = 0; i < 10; i++) {
      expect(await attemptSignIn(t, "victim@example.com", `guess-${i}`)).toBe("InvalidSecret");
    }

    // Bucket empty: even the CORRECT password is refused while limited —
    // this is what stops offline-style password spraying.
    expect(await attemptSignIn(t, "victim@example.com", "correct-horse-battery")).toBe(
      "TooManyFailedAttempts",
    );
  }, 20_000); // 11 auth-store round trips — the default 5s trips under parallel workers

  test("unknown accounts are not enumerable through the limiter", async () => {
    const t = setup();
    // No account exists: consistent error, no state to poison.
    expect(await attemptSignIn(t, "nobody@example.com", "whatever")).toBe("InvalidAccountId");
    const limits = await t.run((ctx) => ctx.db.query("authRateLimits").collect());
    expect(limits).toHaveLength(0);
  });
});

describe("session revocation (PH0-20)", () => {
  test("revokeOtherSessions deletes every session but the caller's", async () => {
    const t = setup();
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        email: "multi@example.com",
        name: "Multi Device",
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const [keep] = await t.run(async (ctx) => [
      await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 60_000 }),
      await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 60_000 }),
      await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 60_000 }),
    ]);

    const asUser = t.withIdentity({ subject: `${userId}|${keep}` });
    const result = await asUser.action(api.authSessions.revokeOtherSessions, {});
    expect(result).toEqual({ ok: true });

    const sessions = await t.run((ctx) => ctx.db.query("authSessions").collect());
    expect(sessions.map((s) => s._id)).toEqual([keep]);
  });

  test("revokeOtherSessions requires authentication", async () => {
    const t = setup();
    await expect(t.action(api.authSessions.revokeOtherSessions, {})).rejects.toThrow(
      "Not authenticated",
    );
  });
});
