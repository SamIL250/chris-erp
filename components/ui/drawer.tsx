"use client";

import { XClose } from "@untitledui/icons";
import { useContext, type HTMLAttributes, type ReactNode } from "react";
import {
  Dialog,
  DialogTrigger,
  Modal,
  ModalOverlay,
  OverlayTriggerStateContext,
  type DialogProps,
  type DialogTriggerProps,
  type ModalOverlayProps,
} from "react-aria-components";
import { Button } from "@/components/base/buttons/button";
import { cx } from "@/utils/cx";

/**
 * Right-side slide-over drawer. Untitled UI free tier has no drawer — built on the
 * same react-aria primitives its modal uses.
 *
 * Usage:
 *   <Drawer>
 *     <Button color="secondary">View details</Button>
 *     <DrawerOverlay>
 *       <DrawerPanel>
 *         <DrawerDialog title="Order details" description="SO-1042">
 *           <DrawerBody>…</DrawerBody>
 *           <DrawerFooter>…</DrawerFooter>
 *         </DrawerDialog>
 *       </DrawerPanel>
 *     </DrawerOverlay>
 *   </Drawer>
 */
export const Drawer = (props: DialogTriggerProps) => <DialogTrigger {...props} />;

export const DrawerOverlay = ({ className, isDismissable = true, ...props }: ModalOverlayProps) => (
  <ModalOverlay
    isDismissable={isDismissable}
    {...props}
    className={(state) =>
      cx(
        "bg-overlay/70 fixed inset-0 z-50 flex justify-end outline-hidden backdrop-blur-[6px]",
        state.isEntering && "animate-in fade-in duration-300 ease-out",
        state.isExiting && "animate-out fade-out duration-200 ease-in",
        typeof className === "function" ? className(state) : className,
      )
    }
  />
);

export const DrawerPanel = ({ className, ...props }: ModalOverlayProps) => (
  <Modal
    {...props}
    className={(state) =>
      cx(
        "bg-primary h-full w-full max-w-md shadow-xl outline-hidden",
        state.isEntering && "animate-in slide-in-from-right duration-300 ease-out",
        state.isExiting && "animate-out slide-out-to-right duration-200 ease-in",
        typeof className === "function" ? className(state) : className,
      )
    }
  />
);

export interface DrawerDialogProps extends Omit<DialogProps, "children"> {
  /** Visible heading and (when a string) the accessible name of the dialog. */
  title: ReactNode;
  description?: ReactNode;
  /** Show the × close button in the header. @default true */
  showClose?: boolean;
  children?: ReactNode;
}

export function DrawerDialog({
  title,
  description,
  showClose = true,
  className,
  children,
  ...props
}: DrawerDialogProps) {
  // Provided by DialogTrigger — closes the drawer programmatically.
  const state = useContext(OverlayTriggerStateContext);

  return (
    <Dialog
      aria-label={typeof title === "string" ? title : props["aria-label"]}
      {...props}
      className={cx("flex h-full flex-col outline-hidden", className)}
    >
      <div className="border-tertiary flex items-start justify-between gap-4 border-b px-6 py-4">
        <div className="min-w-0">
          <h2 className="text-md text-primary font-semibold">{title}</h2>
          {description ? <p className="text-secondary mt-0.5 text-sm">{description}</p> : null}
        </div>
        {showClose ? (
          <Button
            color="tertiary"
            size="sm"
            aria-label="Close"
            iconLeading={XClose}
            noTextPadding
            className="shrink-0"
            onPress={() => state?.close()}
          />
        ) : null}
      </div>
      {children}
    </Dialog>
  );
}

/** Scrollable middle section of the drawer. */
export function DrawerBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("flex-1 overflow-y-auto px-6 py-4", className)} {...props} />;
}

/** Sticky bottom action row. */
export function DrawerFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        "border-tertiary flex shrink-0 items-center justify-end gap-3 border-t px-6 py-4",
        className,
      )}
      {...props}
    />
  );
}
