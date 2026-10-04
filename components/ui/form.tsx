"use client";

/**
 * Form pattern (PH0-09).
 *
 * - `useZodForm(schema, { defaultValues })` — react-hook-form + zodResolver.
 * - `<Form methods={…} onSubmit={…}>` — FormProvider + <form> wrapper.
 * - `<FormInput / FormTextarea / FormSelect / FormCheckbox>` — field components that
 *   read the form context, render Untitled UI primitives, and surface validation
 *   errors inline (Input/TextArea/Select show errors via their `hint` + isInvalid).
 * - `<FormAlert>` — top-level banner for server (Convex) errors.
 *
 * Full pattern + server-error mapping: docs/forms-and-validation.md
 */
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Controller,
  FormProvider,
  useForm,
  useFormContext,
  type FieldPath,
  type FieldValues,
  type Resolver,
  type UseFormProps,
  type UseFormReturn,
} from "react-hook-form";
import type { ComponentProps, ReactNode } from "react";
import type { z } from "zod";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Input, type InputProps } from "@/components/base/input/input";
import { Select, type SelectItemType, type SelectProps } from "@/components/base/select/select";
import { TextArea } from "@/components/base/textarea/textarea";
import { cx } from "@/utils/cx";

/** Create a react-hook-form instance backed by a zod schema (validates onBlur). */
export function useZodForm<TSchema extends z.ZodType<FieldValues, FieldValues>>(
  schema: TSchema,
  options?: Omit<UseFormProps<z.input<TSchema>, unknown, z.output<TSchema>>, "resolver">,
) {
  return useForm<z.input<TSchema>, unknown, z.output<TSchema>>({
    mode: "onBlur",
    ...options,
    resolver: zodResolver(schema) as unknown as Resolver<
      z.input<TSchema>,
      unknown,
      z.output<TSchema>
    >,
  });
}

type FormMethods<TIn extends FieldValues, TOut> = UseFormReturn<TIn, unknown, TOut>;

export interface FormProps<TIn extends FieldValues, TOut> {
  methods: FormMethods<TIn, TOut>;
  onSubmit: (values: TOut) => void | Promise<void>;
  children: ReactNode;
  className?: string;
  id?: string;
}

/** FormProvider + <form noValidate>. Validation runs via the zod resolver. */
export function Form<TIn extends FieldValues, TOut = TIn>({
  methods,
  onSubmit,
  children,
  className,
  id,
}: FormProps<TIn, TOut>) {
  return (
    <FormProvider {...methods}>
      <form onSubmit={methods.handleSubmit(onSubmit)} noValidate className={className} id={id}>
        {children}
      </form>
    </FormProvider>
  );
}

interface FieldBase<T extends FieldValues> {
  name: FieldPath<T>;
  label?: string;
  /** Helper text shown when there is no validation error. */
  hint?: ReactNode;
  /** Show the required asterisk + block empty submit. */
  required?: boolean;
}

/** Text input bound to a form field. */
export function FormInput<T extends FieldValues>({
  name,
  label,
  hint,
  required,
  ...inputProps
}: FieldBase<T> &
  Omit<InputProps, "name" | "label" | "hint" | "isRequired" | "value" | "onChange">) {
  const { control } = useFormContext<T>();

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Input
          {...inputProps}
          label={label}
          hint={fieldState.error?.message ?? hint}
          isInvalid={!!fieldState.error}
          isRequired={required}
          name={field.name}
          value={field.value ?? ""}
          onChange={field.onChange}
          onBlur={field.onBlur}
        />
      )}
    />
  );
}

/** Multi-line text input bound to a form field. */
export function FormTextarea<T extends FieldValues>({
  name,
  label,
  hint,
  required,
  ...textareaProps
}: FieldBase<T> &
  Omit<
    ComponentProps<typeof TextArea>,
    "name" | "label" | "hint" | "isRequired" | "value" | "onChange"
  >) {
  const { control } = useFormContext<T>();

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <TextArea
          {...textareaProps}
          label={label}
          hint={fieldState.error?.message ?? hint}
          isInvalid={!!fieldState.error}
          isRequired={required}
          name={field.name}
          value={field.value ?? ""}
          onChange={field.onChange}
          onBlur={field.onBlur}
        />
      )}
    />
  );
}

export interface FormSelectProps<T extends FieldValues>
  extends
    Omit<FieldBase<T>, "hint">,
    Omit<
      SelectProps,
      | "name"
      | "label"
      | "hint"
      | "isRequired"
      | "items"
      | "children"
      | "value"
      | "onChange"
      | "selectedKey"
      | "onSelectionChange"
    > {
  items: SelectItemType[];
  /** Helper text shown when there is no validation error (Select hint is plain text). */
  hint?: string;
  placeholder?: string;
}

/** Dropdown select bound to a form field (stores the item id). */
export function FormSelect<T extends FieldValues>({
  name,
  label,
  hint,
  required,
  items,
  placeholder,
  ...selectProps
}: FormSelectProps<T>) {
  const { control } = useFormContext<T>();

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Select
          {...selectProps}
          aria-label={label}
          label={label}
          hint={fieldState.error?.message ?? hint}
          isInvalid={!!fieldState.error}
          isRequired={required}
          placeholder={placeholder}
          items={items}
          value={field.value ?? ""}
          onChange={field.onChange}
          onBlur={field.onBlur}
        >
          {(item) => (
            <Select.Item id={item.id} key={item.id} isDisabled={item.isDisabled}>
              {item.label}
            </Select.Item>
          )}
        </Select>
      )}
    />
  );
}

/** Checkbox bound to a form field (stores a boolean). */
export function FormCheckbox<T extends FieldValues>({
  name,
  label,
  hint,
  required: _required,
  ...checkboxProps
}: FieldBase<T> &
  Omit<Parameters<typeof Checkbox>[0], "name" | "label" | "isSelected" | "onChange">) {
  const { control } = useFormContext<T>();
  void _required;

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <div className="space-y-1">
          <Checkbox
            {...checkboxProps}
            label={label}
            isSelected={!!field.value}
            isInvalid={!!fieldState.error}
            onChange={field.onChange}
            onBlur={field.onBlur}
          />
          {fieldState.error ? (
            <p className="text-fg-error-secondary text-sm">{fieldState.error.message}</p>
          ) : hint ? (
            <p className="text-secondary text-sm">{hint}</p>
          ) : null}
        </div>
      )}
    />
  );
}

/** Top-level error banner for server (Convex) failures. `role="alert"` for a11y. */
export function FormAlert({ title, message }: { title?: string; message: string }) {
  return (
    <div role="alert" className="bg-error-secondary border-error_subtle rounded-xl border p-4">
      <p className="text-md text-fg-error-primary font-medium">{title ?? "Something went wrong"}</p>
      <p className="text-fg-error-secondary mt-0.5 text-sm">{message}</p>
    </div>
  );
}

/** Right-aligned action row at the bottom of a form. */
export function FormActions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("flex items-center justify-end gap-3", className)}>{children}</div>;
}
