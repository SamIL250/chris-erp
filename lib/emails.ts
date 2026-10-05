/**
 * Email delivery for Convex code (invite emails, PH0-19; password-reset
 * emails use the same sender via `convex/auth.ts`).
 *
 * Uses Resend when `RESEND_API_KEY` is set on the deployment
 * (`npx convex env set RESEND_API_KEY …`). Without a key — e.g. local dev —
 * the content is logged instead (`npx convex logs`) so flows stay testable
 * and callers can surface the link in the UI.
 *
 * Lives in `lib/` (not `convex/`) so it's a plain module — imported and
 * bundled by Convex, never referenced by client code.
 */

export interface EmailPayload {
  to: string;
  subject: string;
  text: string;
}

/** `true` when the email was handed to Resend; `false` when only logged (dev). */
export async function sendEmail({ to, subject, text }: EmailPayload): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(`[email] to=${to} subject=${subject}\n${text}`);
    return false;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM ?? "Chris ERP <onboarding@resend.dev>",
      to: [to],
      subject,
      text,
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to send email (${res.status}): ${await res.text()}`);
  }
  return true;
}
