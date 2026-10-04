"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { Form, FormAlert, FormInput, useZodForm } from "@/components/ui/form";
import { toUserMessage } from "@/lib/errors";
import { signupSchema } from "@/lib/schemas/auth";
import { AuthHeading } from "../auth-heading";
import { GoogleSignIn } from "../google-sign-in";

export default function SignupPage() {
  const router = useRouter();
  const { signIn } = useAuthActions();
  const methods = useZodForm(signupSchema, {
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
  });
  const [serverError, setServerError] = useState<string | null>(null);

  return (
    <div>
      <AuthHeading title="Create your account" subtitle="Start managing your workspace" />

      <Form
        methods={methods}
        className="space-y-5"
        onSubmit={async (values) => {
          setServerError(null);
          try {
            await signIn("password", {
              name: values.name,
              email: values.email,
              password: values.password,
              flow: "signUp",
            });
            router.push("/dashboard");
            router.refresh();
          } catch (error) {
            setServerError(toUserMessage(error));
          }
        }}
      >
        {serverError ? <FormAlert message={serverError} /> : null}
        <FormInput name="name" label="Full name" autoComplete="name" autoFocus required />
        <FormInput name="email" label="Email" type="email" autoComplete="email" required />
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

      <div className="mt-6">
        <GoogleSignIn />
      </div>

      <p className="text-secondary text-md mt-6 text-center">
        Already have an account?{" "}
        <Link href="/login" className="text-brand-600 font-medium hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
