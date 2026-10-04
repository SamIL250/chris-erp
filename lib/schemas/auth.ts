import { z } from "zod";

/**
 * Auth form schemas (PH0-17) — validated client-side by react-hook-form
 * (see components/ui/form.tsx + docs/forms-and-validation.md).
 */

const emailField = z.string().trim().min(1, "Email is required").email("Enter a valid email");

/** Mirrors Convex Auth's default rule (min 8 chars) so errors surface inline. */
export const passwordField = z.string().min(8, "Use at least 8 characters");

const confirmPasswordField = z.string().min(1, "Confirm your password");

function passwordsMatch(values: { password: string; confirmPassword: string }) {
  return values.password === values.confirmPassword;
}

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Password is required"),
});

export const signupSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required"),
    email: emailField,
    password: passwordField,
    confirmPassword: confirmPasswordField,
  })
  .refine(passwordsMatch, { message: "Passwords don't match", path: ["confirmPassword"] });

export const forgotPasswordSchema = z.object({
  email: emailField,
});

export const resetPasswordSchema = z
  .object({
    password: passwordField,
    confirmPassword: confirmPasswordField,
  })
  .refine(passwordsMatch, { message: "Passwords don't match", path: ["confirmPassword"] });

export type LoginValues = z.infer<typeof loginSchema>;
export type SignupValues = z.infer<typeof signupSchema>;
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;
