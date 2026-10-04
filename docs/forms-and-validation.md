# Forms & validation pattern (PH0-09)

How every data-entry form in the ERP and storefront works. Components live in
`components/ui/form.tsx`; they compose Untitled UI primitives with react-hook-form.

## The pieces

| Piece                                                    | Role                                                                                                       |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `useZodForm(schema, { defaultValues })`                  | react-hook-form instance + zod resolver, validates `onBlur`                                                |
| `<Form methods onSubmit>`                                | FormProvider + `<form noValidate>`; `onSubmit` gets **parsed output**                                      |
| `<FormInput / FormTextarea / FormSelect / FormCheckbox>` | field components; read form context, render Untitled UI input, show errors inline via `hint` + `isInvalid` |
| `<FormAlert title message>`                              | top-level banner (`role="alert"`) for **server** errors                                                    |
| `<FormActions>`                                          | right-aligned button row                                                                                   |

## Canonical usage

```tsx
const schema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Enter a valid email"),
  roleId: z.string().min(1, "Pick a role"),
});

export function InviteUserForm() {
  const methods = useZodForm(schema, { defaultValues: { name: "", email: "", roleId: "" } });
  const [serverError, setServerError] = useState<string | null>(null);

  return (
    <Form
      methods={methods}
      onSubmit={async (values) => {
        try {
          await api.users.invite(values); // ← parsed `values` (output), not raw input
          toast.success("Invitation sent");
        } catch (err) {
          setServerError(toUserMessage(err)); // ← server error → FormAlert
        }
      }}
    >
      {serverError ? <FormAlert message={serverError} /> : null}
      <FormInput name="name" label="Full name" required />
      <FormInput name="email" label="Email" type="email" required />
      <FormSelect name="roleId" label="Role" items={roleItems} required />
      <FormActions>
        <Button type="submit" color="primary">
          Send invitation
        </Button>
      </FormActions>
    </Form>
  );
}
```

## Rules

1. **Client validation is UX only.** The server is the authority: every mutation
   re-validates with Convex `v.*` arg validators **and** `requirePermission` +
   invariants (see development plan §engineering conventions). Never trust the client.
2. **One zod schema per form/entity**, colocated in `lib/schemas/<entity>.ts`, exported
   for reuse in tests. Field-level messages are user-facing strings.
3. **Server errors map back to the form:**
   - Structured field errors (`ConvexError({ code, fields: { email: "…" } })`) →
     `methods.setError("email", { message })` per field.
   - Everything else (permission denied, invariant violations, network) →
     `<FormAlert>` via component state. Sanitize: never leak internal stack traces.
   - `ConvexError` is detected with `instanceof ConvexError` from `convex/browser`.
4. **Forms stay client-side** (`"use client"` is already set in `form.tsx`); mutations go
   through `useMutation`, queries through `useQuery` — no Next.js server actions for
   Convex-backed data.
5. **`FormSelect` stores the item id** (`string`), labels come from `items:
SelectItemType[]`. For option lists shared with the UI, define them once in
   `lib/` (e.g. statuses) and reuse.
6. Submission state: disable the submit button with `<Button isLoading>` while the
   mutation promise is pending; `toast.success` on success; navigate or reset after
   create.

## Money inputs

Amounts are edited as decimal text and converted to **integer minor units** before
submitting (`lib/money.ts` helpers): `z.string().regex(/^\d+(\.\d{1,2})?$/)` →
`toMinorUnits(value)`. Never store floats (development plan §conventions).
