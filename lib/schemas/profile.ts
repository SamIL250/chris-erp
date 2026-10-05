import { z } from "zod";

/** Profile settings form (PH0-18). Email is read-only here. */
export const profileSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Keep it under 100 characters"),
  email: z.string(),
});

export type ProfileValues = z.infer<typeof profileSchema>;
