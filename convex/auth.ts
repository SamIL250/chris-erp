import Google from "@auth/core/providers/google";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth, type EmailConfig } from "@convex-dev/auth/server";
import type {
  AnyDataModel,
  DataModelFromSchemaDefinition,
  GenericMutationCtx,
} from "convex/server";
import type schema from "./schema";

/**
 * The auth callbacks receive an untyped (`AnyDataModel`) context; this narrows
 * it to our real schema so index names and document fields are checked.
 */
type AppMutationCtx = GenericMutationCtx<DataModelFromSchemaDefinition<typeof schema>>;
function appCtx(ctx: GenericMutationCtx<AnyDataModel>): AppMutationCtx {
  return ctx as unknown as AppMutationCtx;
}

/**
 * Google OAuth is enabled when credentials are set on the deployment
 * (`npx convex env set AUTH_GOOGLE_ID …` / `AUTH_GOOGLE_SECRET …`).
 * `convex/authProviders.ts` exposes this to the client so the login page
 * only renders the button when it actually works.
 */
const googleEnabled = !!process.env.AUTH_GOOGLE_ID && !!process.env.AUTH_GOOGLE_SECRET;

/**
 * Password-reset email delivery.
 *
 * Uses Resend when RESEND_API_KEY is configured on the deployment
 * (`npx convex env set RESEND_API_KEY …`). In development without a key the
 * link is printed to the Convex logs (`npx convex logs`) so flows are testable.
 */
const resetEmail: EmailConfig = {
  id: "password-reset",
  name: "Password reset",
  type: "email",
  from: process.env.EMAIL_FROM ?? "Chris ERP <onboarding@resend.dev>",
  maxAge: 60 * 30, // link valid 30 minutes
  async sendVerificationRequest({ identifier, url }) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.warn(`[auth] Password reset link for ${identifier}: ${url}`);
      return;
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? "Chris ERP <onboarding@resend.dev>",
        to: [identifier],
        subject: "Reset your Chris ERP password",
        text: `Reset your password by opening this link:\n${url}\n\nIf you didn't request this, you can ignore this email.`,
      }),
    });
    if (!res.ok) {
      throw new Error(`Failed to send reset email (${res.status}): ${await res.text()}`);
    }
  },
};

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      /**
       * Profile built for password flows. Must be SYNCHRONOUS — Password
       * calls this without awaiting. Persisting/updating the `users` document
       * happens in `callbacks.createOrUpdateUser` below (all providers), which
       * adds the app fields (status/createdAt/updatedAt).
       */
      profile(params) {
        const email = String(params.email ?? "")
          .toLowerCase()
          .trim();
        if (!email) {
          throw new Error("Email is required");
        }
        const requestedName = typeof params.name === "string" ? params.name.trim() : "";
        return {
          name: requestedName || email.split("@")[0] || "User",
          email,
        };
      },
      reset: resetEmail,
      // No `verify` → sign-up is usable immediately (email verification lands
      // in Phase 4 together with the real Resend sender).
    }),
    ...(googleEnabled ? [Google] : []),
  ],
  callbacks: {
    /**
     * Single place that creates/updates the `users` document for every flow
     * (password sign-up, Google, reset-code creation). Responsible for the
     * required app fields and for SAFE email/phone linking: an identifier may
     * only claim an existing profile when it was proven (verified by the
     * provider or the flow type) — otherwise a stranger could take over an
     * invited profile just by signing up with its email.
     */
    async createOrUpdateUser(rawCtx, { existingUserId, profile, provider, type }) {
      const ctx = appCtx(rawCtx);
      const now = Date.now();
      const email =
        typeof profile.email === "string" ? profile.email.toLowerCase().trim() : undefined;
      const phone = typeof profile.phone === "string" ? profile.phone.trim() : undefined;
      const name =
        typeof profile.name === "string" && profile.name.trim() !== ""
          ? profile.name.trim()
          : undefined;
      const image =
        typeof profile.image === "string" && profile.image !== "" ? profile.image : undefined;

      const emailLinkable =
        profile.emailVerified === true ||
        type === "email" ||
        provider.type === "oauth" ||
        provider.type === "oidc";
      const phoneLinkable = profile.phoneVerified === true || type === "phone";

      // Resolve the target profile. `.take(2)` instead of `.unique()`:
      // duplicate emails are possible (self-signup doesn't link, see above),
      // and an ambiguous match must not link.
      let userId = existingUserId;
      if (userId === null && email !== undefined && emailLinkable) {
        const matches = await ctx.db
          .query("users")
          .withIndex("email", (q) => q.eq("email", email))
          .take(2);
        if (matches.length === 1) userId = matches[0]._id;
      }
      if (userId === null && phone !== undefined && phoneLinkable) {
        const matches = await ctx.db
          .query("users")
          .withIndex("phone", (q) => q.eq("phone", phone))
          .take(2);
        if (matches.length === 1) userId = matches[0]._id;
      }

      if (userId !== null) {
        const existing = await ctx.db.get(userId);
        if (existing !== null) {
          await ctx.db.patch(userId, {
            ...(email !== undefined ? { email } : {}),
            ...(phone !== undefined ? { phone } : {}),
            ...(name !== undefined && !existing.name ? { name } : {}),
            ...(image !== undefined && !existing.image ? { image } : {}),
            updatedAt: now,
          });
          return userId;
        }
      }

      return await ctx.db.insert("users", {
        ...(email !== undefined ? { email } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(name !== undefined ? { name } : {}),
        ...(image !== undefined ? { image } : {}),
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    },
    /** Runs before every session is created: block disabled accounts, track last login. */
    async beforeSessionCreation(rawCtx, { userId }) {
      const ctx = appCtx(rawCtx);
      const user = await ctx.db.get(userId);
      if (user === null) {
        throw new Error("Account not found");
      }
      if (user.status === "disabled") {
        throw new Error("This account has been disabled. Contact your administrator.");
      }
      await ctx.db.patch(userId, { lastLoginAt: Date.now() });
    },
  },
});
