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
import { acceptInviteSchema } from "@/lib/schemas/invite";
import { AuthHeading } from "../auth-heading";

function InvalidLink() {
  return (
    <div className="space-y-5 text-center">
      <FeaturedIcon color="error" size="xl" icon={X} className="mx-auto" />
      <div>
        <h1 className="text-display-xs text-primary font-semibold">
          Invitation invalid or expired
        </h1>
        <p className="text-md text-secondary mt-2">
          This invitation link can&apos;t be used. Ask your administrator to send a new one — links
          expire after 7 days.
        </p>
      </div>
      <Link
        href="/login"
        className="text-brand-600 text-md inline-flex items-center gap-1.5 font-medium hover:underline"
      >
        <ArrowLeft className="size-4" />
        Go to sign in
      </Link>
    </div>
  );
}

/**
 * Invitation acceptance (PH0-19): the emailed link lands here with
 * `?email=` + `?code=`, the invitee picks a name + password, and the
 * sign-up carries the single-use code so it claims exactly the invited
 * profile (see `convex/auth.ts` → `createOrUpdateUser`).
 */
function AcceptInviteForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn } = useAuthActions();
  const methods = useZodForm(acceptInviteSchema, {
    defaultValues: { name: "", password: "", confirmPassword: "" },
  });
  const [serverError, setServerError] = useState<string | null>(null);

  const email = searchParams.get("email");
  const code = searchParams.get("code");
  if (!email || !code) return <InvalidLink />;

  return (
    <div>
      <AuthHeading
        title="Set your password"
        subtitle={`You've been invited to join Chris ERP as ${email}`}
      />

      <Form
        methods={methods}
        className="space-y-5"
        onSubmit={async (values) => {
          setServerError(null);
          try {
            await signIn("password", {
              flow: "signUp",
              email,
              inviteCode: code,
              name: values.name,
              password: values.password,
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
        <FormInput name="name" label="Full name" autoComplete="name" autoFocus required />
        <FormInput
          name="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters"
          required
        />
        <FormInput
          name="confirmPassword"
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          required
        />
        <Button type="submit" color="primary" size="lg" className="w-full">
          Create account
        </Button>
      </Form>
    </div>
  );
}

export default function InvitePage() {
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
      <AcceptInviteForm />
    </Suspense>
  );
}
