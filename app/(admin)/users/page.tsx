"use client";

import { Check } from "@untitledui/icons";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { useState } from "react";
import { Dialog, DialogTrigger, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { Avatar } from "@/components/base/avatar/avatar";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { FeaturedIcon } from "@/components/foundations/featured-icon/featured-icon";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import {
  Form,
  FormActions,
  FormAlert,
  FormInput,
  FormSelect,
  useZodForm,
} from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { toUserMessage } from "@/lib/errors";
import { inviteSchema } from "@/lib/schemas/invite";

/** Rows of `users:list` — the profile plus its assigned role keys (PH0-22). */
type MemberRow = Doc<"users"> & { roleKeys: string[] };

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

/**
 * "Invite user" dialog (PH0-19): creates the invited profile + emails a
 * single-use link. Without a Resend key configured the dev link is shown
 * here so the flow stays testable locally.
 */
function InviteDialog({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const inviteUser = useMutation(api.invites.create);
  const roles = useQuery(api.roles.list);
  const [serverError, setServerError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ email: string; url?: string } | null>(null);
  const methods = useZodForm(inviteSchema, {
    defaultValues: { email: "", name: "", role: "" },
  });

  const setOpen = (open: boolean) => {
    if (!open) {
      setServerError(null);
      setSent(null);
    }
    onOpenChange(open);
  };

  return (
    <DialogTrigger isOpen={isOpen} onOpenChange={setOpen}>
      <ModalOverlay>
        <Modal className="sm:max-w-md">
          <Dialog className="flex max-h-[inherit] flex-col">
            {sent ? (
              <div className="space-y-4 p-6 text-center">
                <FeaturedIcon color="success" size="xl" icon={Check} className="mx-auto" />
                <div>
                  <h2 className="text-display-xs text-primary font-semibold">Invitation sent</h2>
                  <p className="text-secondary text-md mt-1.5">
                    {sent.email} can now set a password from their invitation link.
                  </p>
                </div>
                {sent.url ? (
                  <div className="bg-secondary space-y-2 rounded-xl p-3 text-left">
                    <p className="text-warning text-xs font-medium">
                      No email service is configured — share this link directly:
                    </p>
                    <a
                      href={sent.url}
                      className="text-brand-600 text-xs font-medium break-all hover:underline"
                    >
                      {sent.url}
                    </a>
                  </div>
                ) : null}
                <Button
                  color="secondary"
                  size="lg"
                  className="w-full"
                  onPress={() => setOpen(false)}
                >
                  Done
                </Button>
              </div>
            ) : (
              <div className="p-6">
                <h2 className="text-display-xs text-primary mb-1 font-semibold">Invite user</h2>
                <p className="text-secondary text-md mb-5">
                  They&apos;ll get an email with a link to set their password — valid for 7 days.
                </p>
                <Form
                  methods={methods}
                  className="space-y-5"
                  onSubmit={async (values) => {
                    setServerError(null);
                    try {
                      const result = await inviteUser({
                        email: values.email,
                        name: values.name.trim() || undefined,
                        // "" = no role yet (permission checks deny until an
                        // Owner assigns one); role grants are Owner-only.
                        role: values.role || undefined,
                      });
                      setSent({ email: values.email, url: result.url });
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
                    name="name"
                    label="Full name"
                    autoComplete="name"
                    hint="Optional — they can confirm it when accepting"
                  />
                  <FormSelect
                    name="role"
                    label="Role"
                    placeholder="No role yet"
                    hint="Grants their initial permissions — only an Owner can pick one"
                    items={[
                      { id: "", label: "No role yet" },
                      ...(roles ?? []).map((role) => ({
                        id: role.key,
                        label: role.name,
                        supportingText: role.description,
                      })),
                    ]}
                  />
                  <FormActions>
                    <Button color="secondary" size="lg" onPress={() => setOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      color="primary"
                      size="lg"
                      isLoading={methods.formState.isSubmitting}
                    >
                      Send invitation
                    </Button>
                  </FormActions>
                </Form>
              </div>
            )}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}

/** Users admin (PH0-19/22): member list with roles + invite flow. */
export default function UsersPage() {
  const [inviteOpen, setInviteOpen] = useState(false);
  const { results, isLoading, status, loadMore } = usePaginatedQuery(
    api.users.list,
    {},
    { initialNumItems: 50 },
  );
  const roles = useQuery(api.roles.list);
  const roleLabel = (key: string) => roles?.find((role) => role.key === key)?.name ?? key;

  const columns: DataTableColumn<MemberRow>[] = [
    {
      id: "member",
      header: "Member",
      cell: (row) => (
        <div className="flex items-center gap-3">
          <Avatar
            size="sm"
            src={row.image ?? undefined}
            initials={(row.name ?? row.email ?? "?").slice(0, 1).toUpperCase()}
            alt={row.name ?? "Member"}
          />
          <div className="min-w-0">
            <p className="text-primary truncate text-sm font-medium">{row.name ?? "—"}</p>
            <p className="text-tertiary truncate text-xs">{row.email ?? row.phone ?? "No email"}</p>
          </div>
        </div>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <Badge color={STATUS[row.status].color} size="sm">
          {STATUS[row.status].label}
        </Badge>
      ),
    },
    {
      id: "role",
      header: "Role",
      cell: (row) =>
        row.roleKeys.length > 0 ? (
          <Badge color="brand" size="sm">
            {row.roleKeys.map(roleLabel).join(", ")}
          </Badge>
        ) : (
          <span className="text-tertiary text-sm">No role</span>
        ),
    },
    {
      id: "lastLogin",
      header: "Last sign-in",
      cell: (row) => <span className="text-secondary text-sm">{formatDate(row.lastLoginAt)}</span>,
    },
    {
      id: "joined",
      header: "Member since",
      cell: (row) => <span className="text-secondary text-sm">{formatDate(row.createdAt)}</span>,
    },
  ];

  const inviteButton = (
    <Button color="primary" size="sm" onPress={() => setInviteOpen(true)}>
      Invite user
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Users"
        description="People with access to this workspace — invite teammates and track their status."
        actions={inviteButton}
      />
      <DataTable
        title="Members"
        columns={columns}
        rows={results}
        rowId={(row) => row._id}
        toolbar={inviteButton}
        pagination={{
          isLoading,
          hasMore: status === "CanLoadMore",
          onLoadMore: () => loadMore(50),
        }}
        empty={{
          title: "No users yet",
          description: "Invite your first teammate to get started.",
          action: inviteButton,
        }}
      />
      <InviteDialog isOpen={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  );
}
