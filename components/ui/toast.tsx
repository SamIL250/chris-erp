"use client";

import { Toaster as SonnerToaster, type ToasterProps } from "sonner";

export { toast } from "sonner";

/**
 * Toast system (sonner), styled with Untitled UI tokens.
 *
 * Mount once in the root layout: `<Toaster />`
 * Usage: `toast("Saved");` · `toast.error("Something went wrong");`
 *        `toast.success("Order SO-1042 created", { description: "…" });`
 */
export function Toaster(props: ToasterProps) {
  const { toastOptions, ...rest } = props;

  return (
    <SonnerToaster
      position="top-right"
      gap={12}
      {...rest}
      toastOptions={{
        unstyled: true,
        ...toastOptions,
        classNames: {
          toast:
            "relative flex w-full items-start gap-3 rounded-xl border border-tertiary bg-primary p-4 pr-10 shadow-xl",
          content: "flex min-w-0 flex-col gap-0.5",
          title: "text-md font-medium text-primary",
          description: "text-sm text-secondary",
          cancelButton: "bg-tertiary text-secondary rounded-lg px-3 py-1.5 text-sm font-medium",
          actionButton:
            "bg-brand-solid hover:bg-brand-solid_hover text-white rounded-lg px-3 py-1.5 text-sm font-medium",
          closeButton:
            "text-secondary hover:text-primary absolute top-3 right-3 size-5 cursor-pointer",
          ...toastOptions?.classNames,
        },
      }}
    />
  );
}
