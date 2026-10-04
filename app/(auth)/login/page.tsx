"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { Form, FormAlert, FormInput, useZodForm } from "@/components/ui/form";
import { safeNextPath } from "@/lib/auth";
import { toUserMessage } from "@/lib/errors";
import { loginSchema } from "@/lib/schemas/auth";
import { AuthHeading } from "../auth-heading";
import { GoogleSignIn } from "../google-sign-in";

export default function LoginPage() {
  const router = useRouter();
  const { signIn } = useAuthActions();
  const methods = useZodForm(loginSchema, { defaultValues: { email: "", password: "" } });
  const [serverError, setServerError] = useState<string | null>(null);

  return (
    <div>
      <AuthHeading title="Sign in" subtitle="Welcome back to your workspace" />

      <Form
        methods={methods}
        className="space-y-5"
        onSubmit={async (values) => {
          setServerError(null);
          try {
            await signIn("password", {
              email: values.email,
              password: values.password,
              flow: "signIn",
            });
            router.push(safeNextPath());
            router.refresh();
          } catch (error) {
            setServerError(toUserMessage(error));
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
        <FormInput
          name="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          required
        />
        <div className="flex justify-end">
          <Link
            href="/forgot-password"
            className="text-brand-600 text-md font-medium hover:underline"
          >
            Forgot password?
          </Link>
        </div>
        <Button type="submit" color="primary" size="lg" className="w-full">
          Sign in
        </Button>
      </Form>

      <div className="mt-6">
        <GoogleSignIn />
      </div>

      <p className="text-secondary text-md mt-6 text-center">
        Don&apos;t have an account?{" "}
        <Link href="/signup" className="text-brand-600 font-medium hover:underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
