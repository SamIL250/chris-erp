"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Avatar } from "@/components/base/avatar/avatar";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Card } from "@/components/ui/card";
import { Form, FormActions, FormAlert, FormInput, useZodForm } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { toUserMessage } from "@/lib/errors";
import { profileSchema } from "@/lib/schemas/profile";

const STATUS: Record<
  Doc<"users">["status"],
  { label: string; color: "success" | "warning" | "error" }
> = {
  active: { label: "Active", color: "success" },
  invited: { label: "Invited", color: "warning" },
  disabled: { label: "Disabled", color: "error" },
};

function formatDate(timestamp?: number) {
  return timestamp
    ? new Date(timestamp).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—";
}

function ProfileForm({ me }: { me: Doc<"users"> }) {
  const updateProfile = useMutation(api.users.updateProfile);
  const [serverError, setServerError] = useState<string | null>(null);
  const methods = useZodForm(profileSchema, { defaultValues: { name: me.name ?? "" } });
  const status = STATUS[me.status];
  const initials = (me.name ?? me.email ?? "?").slice(0, 1).toUpperCase();

  return (
    <Card>
      <div className="flex flex-col gap-6 p-6">
        <div className="flex items-center gap-4">
          <Avatar
            size="xl"
            src={me.image ?? undefined}
            initials={initials}
            alt={me.name ?? "Profile"}
          />
          <div className="min-w-0">
            <p className="text-primary text-md font-semibold">{me.name ?? "—"}</p>
            <p className="text-secondary truncate text-sm">{me.email ?? me.phone ?? "No email"}</p>
            <div className="mt-1.5">
              <Badge color={status.color} size="sm">
                {status.label}
              </Badge>
            </div>
          </div>
        </div>

        <Form
          methods={methods}
          className="space-y-5"
          onSubmit={async (values) => {
            setServerError(null);
            try {
              await updateProfile({ name: values.name });
              toast.success("Profile updated");
            } catch (error) {
              setServerError(toUserMessage(error));
            }
          }}
        >
          {serverError ? <FormAlert message={serverError} /> : null}
          <div className="grid gap-5 sm:grid-cols-2">
            <FormInput name="name" label="Full name" autoComplete="name" required />
            <FormInput
              name="email"
              label="Email"
              type="email"
              isReadOnly
              hint="Contact an administrator to change your email"
            />
          </div>
          <FormActions>
            <Button
              type="submit"
              color="primary"
              size="lg"
              isLoading={methods.formState.isSubmitting}
            >
              Save changes
            </Button>
          </FormActions>
        </Form>

        <dl className="border-tertiary grid grid-cols-2 gap-4 border-t pt-5 text-sm">
          <div>
            <dt className="text-tertiary">Member since</dt>
            <dd className="text-primary font-medium">{formatDate(me.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-tertiary">Last sign-in</dt>
            <dd className="text-primary font-medium">{formatDate(me.lastLoginAt)}</dd>
          </div>
        </dl>
      </div>
    </Card>
  );
}

/** Profile settings (PH0-18): name, avatar, status, account metadata. */
export default function ProfilePage() {
  const me = useQuery(api.users.me);

  if (me === undefined) {
    return (
      <div className="flex max-w-3xl flex-col gap-6">
        <PageHeader title="Profile" description="Your account details." />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (me === null) {
    return (
      <div className="max-w-3xl">
        <PageHeader title="Profile" description="Your account details." />
        <p className="text-secondary text-md mt-4">
          Your session has expired — sign in again to manage your profile.
        </p>
      </div>
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Profile"
        description="Your account details and how you appear across the workspace."
      />
      <ProfileForm me={me} />
    </div>
  );
}
