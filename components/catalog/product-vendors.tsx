"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { FormAlert } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { toUserMessage } from "@/lib/errors";

/**
 * Vendors for one product (PH2-04). The first link is preferred.
 * Last purchase price is filled in by a goods receipt, not this form.
 */
export function ProductVendors({
  productId,
  canEdit,
}: {
  productId: Id<"products">;
  canEdit: boolean;
}) {
  const links = useQuery(api.catalog.productVendors.listForProduct, { productId });
  const vendors = useQuery(api.procurement.vendors.list, canEdit ? { active: true } : "skip");
  const linkVendor = useMutation(api.catalog.productVendors.link);
  const update = useMutation(api.catalog.productVendors.update);
  const remove = useMutation(api.catalog.productVendors.remove);
  const [vendorId, setVendorId] = useState("");
  const [vendorSku, setVendorSku] = useState("");
  const [preferred, setPreferred] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (links === undefined) return null;

  const taken = new Set(links.map((row) => row.vendorId));
  const choices = (vendors ?? []).filter((row) => !taken.has(row._id));

  const add = async () => {
    setError(null);
    if (vendorId === "") {
      setError("Choose a vendor.");
      return;
    }
    setBusy(true);
    try {
      await linkVendor({
        productId,
        vendorId: vendorId as Id<"vendors">,
        vendorSku: vendorSku.trim() === "" ? null : vendorSku,
        preferred,
      });
      setVendorId("");
      setVendorSku("");
      setPreferred(true);
      toast.success("Vendor linked");
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const saveSku = async (linkId: Id<"productVendors">, currentPreferred: boolean) => {
    setError(null);
    const sku = drafts[linkId] ?? "";
    setBusy(true);
    try {
      await update({
        linkId,
        vendorSku: sku.trim() === "" ? null : sku,
        preferred: currentPreferred,
      });
      toast.success("Vendor SKU saved");
    } catch (err) {
      setError(toUserMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="bg-primary ring-primary space-y-4 rounded-xl p-5 ring-1">
      <div>
        <h2 className="text-primary text-md font-semibold">Vendors</h2>
        <p className="text-tertiary text-sm">
          One vendor is preferred. A receipt that names the vendor and a unit cost updates the last
          purchase price.
        </p>
      </div>
      {error ? <FormAlert title="Couldn't save the vendor link" message={error} /> : null}
      {links.length === 0 ? (
        <p className="text-tertiary text-sm">No vendors yet. The first one is preferred.</p>
      ) : (
        <ul className="divide-secondary divide-y">
          {links.map((row) => {
            const sku = drafts[row._id] ?? row.vendorSku ?? "";
            return (
              <li key={row._id} className="space-y-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-primary text-sm font-medium">
                      <a className="hover:underline" href={`/procurement/vendors/${row.vendorId}`}>
                        {row.vendorCode} · {row.vendorName}
                      </a>
                      {row.vendorActive ? "" : " (inactive)"}
                    </p>
                    <p className="text-tertiary text-sm">
                      Last purchase{" "}
                      {row.lastPurchasePrice === null
                        ? "—"
                        : row.lastPurchasePrice.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                    </p>
                  </div>
                  {row.preferred ? (
                    <Badge color="success" size="sm">
                      Preferred
                    </Badge>
                  ) : canEdit ? (
                    <Button
                      size="sm"
                      color="tertiary"
                      isDisabled={busy}
                      onPress={() =>
                        void update({
                          linkId: row._id,
                          vendorSku: row.vendorSku,
                          preferred: true,
                        })
                          .then(() => toast.success("Preferred vendor updated"))
                          .catch((err: unknown) => setError(toUserMessage(err)))
                      }
                    >
                      Make preferred
                    </Button>
                  ) : null}
                </div>
                {canEdit ? (
                  <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
                    <Input
                      label="Vendor SKU"
                      value={sku}
                      onChange={(value) => setDrafts((prev) => ({ ...prev, [row._id]: value }))}
                    />
                    <Button
                      size="sm"
                      color="secondary"
                      isDisabled={busy}
                      onPress={() => void saveSku(row._id, row.preferred)}
                    >
                      Save SKU
                    </Button>
                    <Button
                      size="sm"
                      color="tertiary"
                      isDisabled={busy}
                      onPress={() =>
                        void remove({ linkId: row._id })
                          .then(() => toast.success("Vendor removed"))
                          .catch((err: unknown) => setError(toUserMessage(err)))
                      }
                    >
                      Remove
                    </Button>
                  </div>
                ) : (
                  <p className="text-secondary text-sm">Vendor SKU {row.vendorSku ?? "—"}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canEdit ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            aria-label="Vendor"
            label="Vendor"
            placeholder="Choose a vendor"
            items={choices.map((row) => ({ id: row._id, label: `${row.code} · ${row.name}` }))}
            value={vendorId}
            onChange={(key) => setVendorId(key == null ? "" : String(key))}
          >
            {(item) => (
              <Select.Item id={item.id} key={item.id}>
                {item.label}
              </Select.Item>
            )}
          </Select>
          <Input label="Vendor SKU" value={vendorSku} onChange={setVendorSku} />
          <Checkbox
            label="Preferred"
            hint="The first vendor is preferred even if this is off."
            isSelected={preferred}
            onChange={setPreferred}
          />
          <div className="flex items-end">
            <Button color="secondary" isLoading={busy} onPress={() => void add()}>
              Link vendor
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
