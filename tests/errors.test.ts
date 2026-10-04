import { describe, expect, test } from "vitest";
import { isAccountNotFound, toUserMessage } from "../lib/errors";

const devTrace =
  "[Request ID: 675dc105906ebdd2] Server Error\n" +
  "Uncaught Error: InvalidSecret\n" +
  "    at retrieveAccount (../../node_modules/@convex-dev/auth/src/server/implementation/index.ts:602:9)";

describe("toUserMessage", () => {
  test("unwraps Convex dev stack traces to the thrown message", () => {
    expect(toUserMessage(new Error(devTrace))).toBe("Incorrect email or password.");
  });

  test("maps Convex Auth password-flow codes", () => {
    expect(toUserMessage(new Error("Invalid credentials"))).toBe("Incorrect email or password.");
    expect(toUserMessage(new Error("InvalidAccountId"))).toBe("Incorrect email or password.");
    expect(toUserMessage(new Error("TooManyFailedAttempts"))).toContain(
      "Too many sign-in attempts",
    );
    expect(toUserMessage(new Error("Invalid password"))).toBe(
      "Password must be at least 8 characters.",
    );
    expect(toUserMessage(new Error("Could not verify code"))).toContain("invalid or has expired");
    expect(toUserMessage(new Error("Password reset is not enabled for password"))).toContain(
      "Password reset is not enabled",
    );
    expect(
      toUserMessage(new Error("This account has been disabled. Contact your administrator.")),
    ).toContain("disabled");
    expect(toUserMessage(new Error("Account owner2@example.com already exists"))).toContain(
      "already exists",
    );
  });

  test("bare production redaction falls back to a generic message", () => {
    expect(toUserMessage(new Error("[Request ID: abc] Server Error"))).toBe(
      "Something went wrong. Please try again.",
    );
    expect(toUserMessage(undefined)).toBe("Something went wrong. Please try again.");
  });

  test("unknown messages pass through", () => {
    expect(toUserMessage(new Error("Some new library message"))).toBe("Some new library message");
    expect(toUserMessage("plain string")).toBe("plain string");
  });
});

describe("isAccountNotFound", () => {
  test("detects unknown-email codes, including inside dev traces", () => {
    expect(isAccountNotFound(new Error("InvalidAccountId"))).toBe(true);
    expect(isAccountNotFound(new Error("Invalid credentials"))).toBe(true);
    expect(
      isAccountNotFound(
        new Error("[Request ID: x] Server Error\nUncaught Error: InvalidAccountId\n    at …"),
      ),
    ).toBe(true);
    expect(isAccountNotFound(new Error("InvalidSecret"))).toBe(false);
  });
});
