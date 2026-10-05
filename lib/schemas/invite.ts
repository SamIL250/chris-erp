import { z } from "zod";
import { emailField, passwordField } from "./auth";

/**
 * Invite forms (PH0-19).
 * - `inviteSchema`: the admin's "Invite user" modal (email + optional name).
 * - `acceptInviteSchema`: the invitee's set-password page (`/invite`).
 */

export const inviteSchema = z.object({
  email: emailField,
  name: z.string().trim().max(100, "Keep it under 100 characters"),
});

export const acceptInviteSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(100, "Keep it under 100 characters"),
    password: passwordField,
    confirmPassword: z.string().min(1, "Confirm your password"),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export type InviteValues = z.infer<typeof inviteSchema>;
export type AcceptInviteValues = z.infer<typeof acceptInviteSchema>;
