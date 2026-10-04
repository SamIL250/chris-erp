"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { ArrowLeft, X } from "@untitledui/icons";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { Form, FormAlert, FormInput, useZodForm } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/skeleton";
import { toUserMessage } from "@/lib/errors";
import { resetPasswordSchema } from "@/lib/schemas/auth";
import { AuthHeading } from "../auth-heading";

function InvalidLink() {
  return (
    <div className="space-y-5 text-center">
      <FeaturedIcon color="error" size="xl" icon={X} className="mx-auto" />
      <div>
        <h1 className="text-display-xs text-primary font-semibold">Link invalid or expired</h1>
        <p className="text-md text-secondary mt-2">
          This password reset link can&apos;t be used. Request a new one — links expire after 30
          minutes.
        </p>
      </div>
      <Link
        href="/forgot-password"
        className="text-brand-600 text-md inline-flex items-center gap-1.5 font-medium hover:underline"
      >
        <ArrowLeft className="size-4" />
        Request a new link
      </Link>
    </div>
  );
}

/**
 * Completes the password-reset flow: the emailed link lands here with
 * `?code=` + `?email=` (the proxy deliberately leaves them alone) and we
 * exchange the one-time code for a new password.
 */
function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn } = useAuthActions();
  const methods = useZodForm(resetPasswordSchema, {
    defaultValues: { password: "", confirmPassword: "" },
  });
  const [serverError, setServerError] = useState<string | null>(null);

  const email = searchParams.get("email");
  const code = searchParams.get("code");
  if (!email || !code) return <InvalidLink />;

  return (
    <div>
      <AuthHeading title="Choose a new password" subtitle={`Setting a new password for ${email}`} />

      <Form
        methods={methods}
        className="space-y-5"
        onSubmit={async (values) => {
          setServerError(null);
          try {
            await signIn("password", {
              flow: "reset-verification",
              email,
              code,
              newPassword: values.password,
            });
            // Replace so the one-time code doesn't stay in history.
            router.replace("/dashboard");
            router.refresh();
          } catch (error) {
            setServerError(toUserMessage(error));
          }
        }}
      >
        {serverError ? <FormAlert message={serverError} /> : null}
        <FormInput
          name="password"
          label="New password"
          type="password"
          autoComplete="new-password"
          autoFocus
          hint="At least 8 characters"
          required
        />
        <FormInput
          name="confirmPassword"
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          required
        />
        <Button type="submit" color="primary" size="lg" className="w-full">
          Reset password
        </Button>
      </Form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
