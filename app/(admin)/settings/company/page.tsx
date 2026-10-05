"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { Card } from "@/components/ui/card";
import {
  Form,
  FormActions,
  FormAlert,
  FormInput,
  FormTextarea,
  useZodForm,
} from "@/components/ui/form";
import { ImageUpload, type UploadedImage } from "@/components/ui/image-upload";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { toUserMessage } from "@/lib/errors";
import { companySchema } from "@/lib/schemas/company";

/** `organization:get` — the stored document plus a freshly signed logo URL. */
type Organization = Doc<"organizations"> & { logoUrl: string | null };

function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <h2 className="text-primary text-md font-semibold">{title}</h2>
      {description ? <p className="text-secondary text-sm">{description}</p> : null}
    </div>
  );
}

function CompanyForm({ org }: { org: Organization | null }) {
  const update = useMutation(api.organization.update);
  const removeFile = useMutation(api.files.remove);
  const [serverError, setServerError] = useState<string | null>(null);
  const [logo, setLogo] = useState<{ fileId: Id<"files"> | null; url: string | null }>(() =>
    org?.logoFileId ? { fileId: org.logoFileId, url: org.logoUrl } : { fileId: null, url: null },
  );

  const methods = useZodForm(companySchema, {
    defaultValues: {
      name: org?.name ?? "",
      legalName: org?.legalName ?? "",
      taxId: org?.taxId ?? "",
      email: org?.email ?? "",
      phone: org?.phone ?? "",
      address: {
        line1: org?.address?.line1 ?? "",
        line2: org?.address?.line2 ?? "",
        city: org?.address?.city ?? "",
        state: org?.address?.state ?? "",
        postalCode: org?.address?.postalCode ?? "",
        country: org?.address?.country ?? "",
      },
      invoiceFooter: org?.invoiceFooter ?? "",
    },
  });

  const handleLogo = (image: UploadedImage | null) => {
    setLogo({ fileId: image?.fileId ?? null, url: image?.url ?? null });
  };

  return (
    <Form
      methods={methods}
      className="flex max-w-3xl flex-col gap-6"
      onSubmit={async (values) => {
        setServerError(null);
        const addressValues = values.address;
        const hasAddress = Object.values(addressValues).some((part) => part.trim() !== "");
        const previousLogo = org?.logoFileId;
        try {
          await update({
            name: values.name,
            legalName: values.legalName || undefined,
            taxId: values.taxId || undefined,
            email: values.email || undefined,
            phone: values.phone || undefined,
            address: hasAddress
              ? {
                  line1: addressValues.line1 || undefined,
                  line2: addressValues.line2 || undefined,
                  city: addressValues.city || undefined,
                  state: addressValues.state || undefined,
                  postalCode: addressValues.postalCode || undefined,
                  country: addressValues.country || undefined,
                }
              : undefined,
            invoiceFooter: values.invoiceFooter || undefined,
            logoFileId: logo.fileId,
          });
          // The new logo is attached now — clean the old one up best-effort.
          if (previousLogo && previousLogo !== logo.fileId) {
            try {
              await removeFile({ fileId: previousLogo });
            } catch {
              // Detached either way; a stray blob won't hurt.
            }
          }
          toast.success("Company settings saved");
        } catch (error) {
          setServerError(toUserMessage(error));
        }
      }}
    >
      <Card>
        <div className="flex flex-col gap-6 p-6">
          <SectionHeading
            title="Company profile"
            description="The legal identity printed on quotes, invoices, and delivery notes."
          />

          <ImageUpload
            label="Logo"
            kind="logo"
            hint="Shown on future documents — PNG, JPG, or WEBP, up to 5 MB."
            previewUrl={logo.url}
            onChange={handleLogo}
          />

          <div className="grid gap-5 sm:grid-cols-2">
            <FormInput name="name" label="Display name" required />
            <FormInput name="legalName" label="Legal name" hint="Registered entity name" />
            <FormInput name="taxId" label="Tax ID / VAT number" />
            <FormInput name="email" label="Contact email" type="email" />
            <FormInput name="phone" label="Phone" type="tel" />
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-6 p-6">
          <SectionHeading
            title="Address"
            description="The company's registered address, printed on documents."
          />
          <div className="grid gap-5">
            <FormInput name="address.line1" label="Street address" />
            <FormInput name="address.line2" label="Street address line 2" />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormInput name="address.city" label="City" />
            <FormInput name="address.state" label="State / region" />
            <FormInput name="address.postalCode" label="Postal code" />
            <FormInput name="address.country" label="Country" />
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-6 p-6">
          <SectionHeading
            title="Documents"
            description="Footer text printed at the bottom of every invoice."
          />
          <FormTextarea
            name="invoiceFooter"
            label="Invoice footer"
            rows={3}
            hint="Payment terms, bank details, or regulatory notices."
          />
          {serverError ? <FormAlert message={serverError} /> : null}
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
        </div>
      </Card>
    </Form>
  );
}

/** Company settings (PH0-29) — `/settings/company`, gated by settings.view. */
export default function CompanySettingsPage() {
  const org = useQuery(api.organization.get);

  if (org === undefined) {
    return (
      <div className="flex max-w-3xl flex-col gap-6">
        <PageHeader title="Company" description="Legal identity, contacts, and letterhead." />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Company"
        description="Legal identity, contact details, and letterhead used across future documents."
      />
      <CompanyForm org={org} />
    </div>
  );
}
