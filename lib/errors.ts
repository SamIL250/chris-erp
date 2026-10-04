/**
 * Map thrown errors (Convex actions, Convex Auth, plain Errors) to messages
 * that are safe to show in a `<FormAlert>` — see docs/forms-and-validation.md.
 *
 * Convex Auth throws plain `Error`s (`InvalidSecret`, `InvalidAccountId`, …);
 * in development Convex wraps them in `[Request ID: …] Server Error` + a stack
 * trace, so we unwrap first, then translate the known codes.
 */

/** Strip Convex's uncaught-error wrapper, keeping just the thrown message. */
function unwrap(raw: string): string {
  const uncaught = raw.match(/Uncaught (?:Convex)?Error:\s*(.*)/);
  if (uncaught) return uncaught[1].trim();
  return raw
    .replace(/^\[Request ID:[^\]]*\]\s*/, "")
    .replace(/^Server Error\s*/, "")
    .trim();
}

function thrownMessage(error: unknown): string {
  const raw = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  return unwrap(raw);
}

const KNOWN: [RegExp, string][] = [
  // Password flow codes (see @convex-dev/auth retrieveAccount):
  // same copy for unknown email + wrong password — don't reveal which.
  [/^(invalidsecret|invalidaccountid|invalid credentials)$/i, "Incorrect email or password."],
  [
    /^toomanyfailedattempts$/i,
    "Too many sign-in attempts. Please wait a few minutes and try again.",
  ],
  [/^invalid password$/i, "Password must be at least 8 characters."],
  [/already exists/i, "An account with this email already exists. Try signing in instead."],
  [
    /could not verify code|^invalid code$/i,
    "This link is invalid or has expired. Request a new one.",
  ],
  [
    /reset is not enabled/i,
    "Password reset is not enabled on this server. Contact your administrator.",
  ],
  [/has been disabled/i, "This account has been disabled. Contact your administrator."],
  [/^missing .*newpassword/i, "Choose a new password."],
];

/** Map any thrown error to a message safe to show in a form. */
export function toUserMessage(error: unknown): string {
  const message = thrownMessage(error);
  if (!message || /^server error$/i.test(message)) {
    return "Something went wrong. Please try again.";
  }
  for (const [pattern, friendly] of KNOWN) {
    if (pattern.test(message)) return friendly;
  }
  return message;
}

/**
 * True when the failure just means "no account for that email" — the
 * forgot-password page uses this to show the same "check your email" panel
 * either way, so the form doesn't reveal which addresses have accounts.
 */
export function isAccountNotFound(error: unknown): boolean {
  return /^(invalidaccountid|invalid credentials)$/i.test(thrownMessage(error));
}
