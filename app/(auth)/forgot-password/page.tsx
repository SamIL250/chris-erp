"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { Check } from "@untitledui/icons";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { Form, FormAlert, FormInput, useZodForm } from "@/components/ui/form";
import { toUserMessage, isAccountNotFound } from "@/lib/errors";
import { forgotPasswordSchema } from "@/lib/schemas/auth";
import { AuthHeading } from "../auth-heading";

export default function ForgotPasswordPage() {
  const { signIn } = useAuthActions();
  const methods = useZodForm(forgotPasswordSchema, { defaultValues: { email: "" } });
  const [serverError, setServerError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (sentTo !== null) {
    return (
      <div className="space-y-5 text-center">
        <FeaturedIcon color="success" size="xl" icon={Check} className="mx-auto" />
        <div>
          <h1 className="text-display-xs text-primary font-semibold">Check your email</h1>
          <p className="text-md text-secondary mt-2">
            If an account exists for <span className="text-primary font-medium">{sentTo}</span>, we
            sent a link to reset the password. It expires in 30 minutes.
          </p>
        </div>
        <p className="text-tertiary text-sm">
          Didn&apos;t get it? Check your spam folder, or{" "}
          <button
            type="button"
            onClick={() => setSentTo(null)}
            className="text-brand-600 font-medium hover:underline"
          >
            try another email
          </button>
          .
        </p>
        <Link href="/login" className="text-brand-600 text-md font-medium hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <div>
      <AuthHeading
        title="Reset your password"
        subtitle="Enter your email and we'll send you a reset link"
      />

      <Form
        methods={methods}
        className="space-y-5"
        onSubmit={async (values) => {
          setServerError(null);
          try {
            await signIn("password", {
              flow: "reset",
              email: values.email,
              redirectTo: `/reset-password?email=${encodeURIComponent(values.email)}`,
            });
            setSentTo(values.email);
          } catch (error) {
            // Unknown email → same "check your email" panel (no enumeration).
            if (isAccountNotFound(error)) {
              setSentTo(values.email);
            } else {
              setServerError(toUserMessage(error));
            }
          }
        }}
      >
        {serverError ? <FormAlert message={serverError} /> : null}
        <FormInput
          name="email"
          label="Email"
          type="email"
          autoComplete="email"
          autoFocus
          required
        />
        <Button type="submit" color="primary" size="lg" className="w-full">
          Send reset link
        </Button>
      </Form>

      <p className="text-secondary text-md mt-6 text-center">
        Remembered it?{" "}
        <Link href="/login" className="text-brand-600 font-medium hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
