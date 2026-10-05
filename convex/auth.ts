import Google from "@auth/core/providers/google";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth, type EmailConfig } from "@convex-dev/auth/server";
import type {
  AnyDataModel,
  DataModelFromSchemaDefinition,
  GenericMutationCtx,
} from "convex/server";
import { ConvexError } from "convex/values";
import { sha256Hex } from "../lib/crypto";
import { sendEmail } from "../lib/emails";
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
 * Password-reset email delivery (PH0-17) via the shared sender (PH0-19) —
 * Resend when `RESEND_API_KEY` is set on the deployment, otherwise the link
 * is printed to the Convex logs (`npx convex logs`).
 */
const resetEmail: EmailConfig = {
  id: "password-reset",
  name: "Password reset",
  type: "email",
  from: process.env.EMAIL_FROM ?? "Chris ERP <onboarding@resend.dev>",
  maxAge: 60 * 30, // link valid 30 minutes
  async sendVerificationRequest({ identifier, url }) {
    await sendEmail({
      to: identifier,
      subject: "Reset your Chris ERP password",
      text: `Reset your password by opening this link:\n${url}\n\nIf you didn't request this, you can ignore this email.`,
    });
  },
};

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  /**
   * Auth rate limiting (PH0-20). The built-in limiter trips after
   * `maxFailedAttempsPerHour` failed password attempts (per account) or code
   * verifications (per email) and then refills one attempt every 6 minutes —
   * enforced inside the auth mutations, so calling the deployment directly
   * can't bypass it. 10/hour is the library default; kept explicit here so
   * the value is deliberate and documented.
   */
  signIn: { maxFailedAttempsPerHour: 10 },
  /**
   * Session handling (PH0-20): absolute lifetime 7 days (re-auth weekly),
   * idle timeout 24 hours (the refresh token's lifetime — an active tab
   * slides it forward, a closed laptop over the weekend requires a fresh
   * sign-in). Both were 30 days by default.
   */
  session: {
    totalDurationMs: 1000 * 60 * 60 * 24 * 7,
    inactiveDurationMs: 1000 * 60 * 60 * 24,
  },
  /**
   * Access-token lifetime (PH0-20): revoking a session (sign-out, "sign out
   * other devices", password reset) deletes it server-side, but an access
   * token already handed out stays valid until ITS expiry — refresh with a
   * deleted session returns `tokens: null` and signs that device out. This
   * bounds the revocation lag (default was 60 minutes). The client refreshes
   * transparently over the same cookies.
   */
  jwt: { durationMs: 1000 * 60 * 15 },
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
        const result: { name: string; email: string; inviteCode?: string } = {
          name: requestedName || email.split("@")[0] || "User",
          email,
        };
        // Invite acceptance (PH0-19): forward the emailed code so
        // `createOrUpdateUser` can verify it (sign-up only).
        const inviteCode =
          params.flow === "signUp" && typeof params.inviteCode === "string"
            ? params.inviteCode
            : "";
        if (inviteCode) result.inviteCode = inviteCode;
        return result;
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
     * invited profile just by signing up with its email. The one exception is
     * invite acceptance (PH0-19): an emailed, single-use invite code proves
     * possession and claims exactly the invited profile.
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

      let userId = existingUserId;

      // ── Invite acceptance (PH0-19) ───────────────────────────────────────
      // A password sign-up carrying the emailed invite code may claim the
      // invited profile: possession of the code (single-use, SHA-256 at rest,
      // 7-day expiry) is the proof. An invalid code ABORTS the sign-up — this
      // runs inside the same mutation that creates the auth account, so no
      // orphaned account is left behind.
      const inviteCode = typeof profile.inviteCode === "string" ? profile.inviteCode : undefined;
      if (inviteCode !== undefined) {
        if (userId !== null || email === undefined) {
          throw new ConvexError("This invitation link is invalid.");
        }
        const invitedMatches = await ctx.db
          .query("users")
          .withIndex("email", (q) => q.eq("email", email))
          .take(2);
        if (invitedMatches.length !== 1) {
          throw new ConvexError(
            "This invitation is no longer valid. Ask an administrator to send a new one.",
          );
        }
        const invitedProfile = invitedMatches[0];
        if (invitedProfile.status === "active") {
          throw new ConvexError("This invitation has already been accepted — sign in instead.");
        }
        if (invitedProfile.status === "disabled") {
          throw new ConvexError("This account has been disabled. Contact your administrator.");
        }
        const codeHash = await sha256Hex(inviteCode);
        const candidates = await ctx.db
          .query("invites")
          .withIndex("by_email", (q) => q.eq("email", email))
          .take(20);
        const valid = candidates.filter(
          (invite) =>
            invite.codeHash === codeHash &&
            invite.acceptedAt === undefined &&
            invite.revokedAt === undefined &&
            invite.expiresAt > now,
        );
        if (valid.length === 0) {
          throw new ConvexError(
            "This invitation link is invalid or has expired. Ask an administrator to send a new one.",
          );
        }
        await ctx.db.patch(invitedProfile._id, {
          ...(name !== undefined ? { name } : {}),
          status: "active",
          updatedAt: now,
        });
        for (const invite of valid) {
          await ctx.db.patch(invite._id, { acceptedAt: now });
        }
        return invitedProfile._id;
      }

      // Resolve the target profile. `.take(2)` instead of `.unique()`:
      // duplicate emails are possible (self-signup doesn't link, see above),
      // and an ambiguous match must not link.
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
            // A proven identity (OAuth / verified email) signing in against an
            // invited profile accepts the invitation (PH0-19). Disabled stays
            // disabled — `beforeSessionCreation` blocks it either way.
            ...(existing.status === "invited" ? { status: "active" as const } : {}),
            updatedAt: now,
          });
          return userId;
        }
      }

      // A password sign-up WITHOUT a code must not create a parallel profile
      // for an invited address — point them at their invitation instead.
      // (OAuth and verified-email flows never reach here: they link above.)
      if (userId === null && email !== undefined) {
        const invitedMatches = await ctx.db
          .query("users")
          .withIndex("email", (q) => q.eq("email", email))
          .take(2);
        if (invitedMatches.length === 1 && invitedMatches[0].status === "invited") {
          throw new ConvexError(
            "You've been invited to join Chris ERP — open the invitation email to set up your account.",
          );
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
    /** Runs before every session is created: block unready accounts, track last login. */
    async beforeSessionCreation(rawCtx, { userId }) {
      const ctx = appCtx(rawCtx);
      const user = await ctx.db.get(userId);
      if (user === null) {
        throw new Error("Account not found");
      }
      if (user.status === "disabled") {
        throw new ConvexError("This account has been disabled. Contact your administrator.");
      }
      if (user.status === "invited") {
        // Defense in depth: sign-in with a password is impossible before the
        // invite is accepted (no auth account yet), and OAuth activates the
        // profile during linking — this covers anything unexpected.
        throw new ConvexError(
          "This invitation hasn't been accepted yet — open your invitation email to set up your account.",
        );
      }
      await ctx.db.patch(userId, { lastLoginAt: Date.now() });
    },
  },
});
