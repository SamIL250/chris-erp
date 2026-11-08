"use client";

import { useQuery } from "convex/react";
import { Button } from "@/components/base/buttons/button";
import { ProductFacts, ProductForm } from "@/components/catalog/product-form";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import { useCan } from "@/hooks/use-can";

/**
 * Product editor shell (PH1-07): loads one product (or create context)
 * plus the shared catalog lists, then renders the editable form — or,
 * for `catalog.view`-only roles, the read-only facts panel (PH1-02
 * pattern). Not-found is a first-class state (the query returns `null`,
 * not a thrown error, so a typo'd URL shows a calm message rather than
 * the error boundary).
 *
 * The Products SIDEBAR entry points at `/catalog/products`, which
 * redirects here to `new` until PH1-08's list owns that route — the
 * PH1-02 `/catalog` → Categories precedent.
 */
export function ProductEditor({ id }: { id?: string }) {
  const canCreate = useCan("catalog", "create");
  const canEdit = useCan("catalog", "edit");
  const canDelete = useCan("catalog", "delete");
  const definitions = useQuery(api.catalog.attributes.list);
  const sets = useQuery(api.catalog.attributeSets.list);
  const categories = useQuery(api.catalog.categories.list);
  const existing = useQuery(api.catalog.products.get, id === undefined ? "skip" : { id });

  const isCreate = id === undefined;
  const loading =
    definitions === undefined ||
    sets === undefined ||
    categories === undefined ||
    (!isCreate && existing === undefined);

  if (loading) {
    return (
      <div className="flex max-w-3xl flex-col gap-6">
        <PageHeader
          title={isCreate ? "New product" : "Product"}
          description="Loading the catalog editor…"
        />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!isCreate && existing === null) {
    return (
      <div className="flex max-w-3xl flex-col gap-6">
        <PageHeader title="Product not found" description="It may have been deleted." />
        <Card>
          <div className="flex items-center justify-between gap-4 p-6">
            <p className="text-secondary text-sm">
              The link points at a product that no longer exists.
            </p>
            <Button color="primary" href="/catalog/products">
              New product
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (isCreate && !canCreate) {
    return (
      <div className="flex max-w-3xl flex-col gap-6">
        <PageHeader title="New product" description="Create products" />
        <Card>
          <p className="text-secondary p-6 text-sm">
            You can view the catalog but not add products — an administrator can create them.
          </p>
        </Card>
      </div>
    );
  }

  const product = isCreate ? null : (existing?.product ?? null);

  if (product !== null && !canEdit) {
    return (
      <ProductFacts
        product={product}
        storedValues={existing?.values ?? []}
        definitions={definitions}
        sets={sets}
        categories={categories}
      />
    );
  }

  return (
    <ProductForm
      key={id ?? "new"}
      product={product}
      storedValues={existing?.values ?? []}
      definitions={definitions}
      sets={sets}
      categories={categories}
      canCreate={canCreate}
      canDelete={canDelete}
    />
  );
}
