"use client";

import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Dialog, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { PriceListForm } from "@/components/sales/price-list-form";
import { PromotionForm } from "@/components/sales/promotion-form";
import { SalesLinePreview } from "@/components/sales/sales-line-preview";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCan } from "@/hooks/use-can";
import { priceDayLabel } from "@/lib/pricing";

type ListRow = {
  _id: Id<"priceLists">;
  name: string;
  currency: string;
  active: boolean;
  isBase: boolean;
  priceCount: number;
};

type PromotionRow = {
  _id: Id<"promotions">;
  name: string;
  startsOn: number;
  endsOn: number;
  active: boolean;
  priceListId: Id<"priceLists"> | null;
  priceListName: string | null;
};

/** Price lists, the promotions that pick one, and a sales-line preview (PH2-09). */
export default function PricesPage() {
  const router = useRouter();
  const canCreate = useCan("sales", "create");
  const lists = useQuery(api.sales.prices.listLists, {});
  const promotions = useQuery(api.sales.prices.listPromotions, {});
  const choices = useQuery(api.sales.prices.currencyChoices, {});
  const [creatingList, setCreatingList] = useState(false);
  const [creatingPromotion, setCreatingPromotion] = useState(false);
  const [editingPromotionId, setEditingPromotionId] = useState<Id<"promotions"> | null>(null);

  const listColumns: DataTableColumn<ListRow>[] = [
    {
      id: "name",
      header: "List",
      cell: (row) => <span className="text-primary text-sm font-medium">{row.name}</span>,
    },
    {
      id: "currency",
      header: "Currency",
      cell: (row) => <span className="text-secondary font-mono text-sm">{row.currency}</span>,
    },
    {
      id: "prices",
      header: "Prices",
      cell: (row) => <span className="text-secondary text-sm tabular-nums">{row.priceCount}</span>,
    },
    {
      id: "base",
      header: "Base",
      cell: (row) =>
        row.isBase ? (
          <Badge color="brand" size="sm">
            Base
          </Badge>
        ) : (
          <span className="text-tertiary text-sm">—</span>
        ),
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <Badge color={row.active ? "success" : "gray"} size="sm">
          {row.active ? "Active" : "Inactive"}
        </Badge>
      ),
    },
  ];

  const promotionColumns: DataTableColumn<PromotionRow>[] = [
    {
      id: "name",
      header: "Promotion",
      cell: (row) => <span className="text-primary text-sm font-medium">{row.name}</span>,
    },
    {
      id: "window",
      header: "Window",
      cell: (row) => (
        <span className="text-secondary text-sm">
          {priceDayLabel(row.startsOn)} – {priceDayLabel(row.endsOn)}
        </span>
      ),
    },
    {
      id: "list",
      header: "List",
      cell: (row) => <span className="text-secondary text-sm">{row.priceListName ?? "—"}</span>,
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <Badge color={row.active ? "success" : "gray"} size="sm">
          {row.active ? "Active" : "Inactive"}
        </Badge>
      ),
    },
  ];

  const editing = promotions?.find((row) => row._id === editingPromotionId) ?? null;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Prices"
        description="Price lists, the promotions that choose one, and what a sales line would charge."
        actions={
          canCreate ? (
            <Button color="primary" onPress={() => setCreatingList(true)}>
              New price list
            </Button>
          ) : null
        }
      />

      {lists === undefined || choices === undefined ? (
        <Skeleton className="h-96" />
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <DataTable
            title="Price lists"
            columns={listColumns}
            rows={lists}
            rowId={(row) => row._id}
            onRowClick={(row) => router.push(`/sales/prices/${row._id}`)}
            empty={{
              title: "No price lists yet",
              description:
                "The first list becomes the base. A sale uses it when no promotion applies.",
              action: canCreate ? (
                <Button color="primary" size="sm" onPress={() => setCreatingList(true)}>
                  New price list
                </Button>
              ) : undefined,
            }}
          />
          <SalesLinePreview />
        </div>
      )}

      {promotions === undefined || lists === undefined ? (
        <Skeleton className="h-64" />
      ) : (
        <DataTable
          title="Promotions"
          columns={promotionColumns}
          rows={promotions}
          rowId={(row) => row._id}
          onRowClick={(row) => setEditingPromotionId(row._id)}
          toolbar={
            canCreate ? (
              <Button color="secondary" size="sm" onPress={() => setCreatingPromotion(true)}>
                New promotion
              </Button>
            ) : null
          }
          empty={{
            title: "No promotions yet",
            description: "A promotion names the list in effect between two dates.",
            action: canCreate ? (
              <Button color="primary" size="sm" onPress={() => setCreatingPromotion(true)}>
                New promotion
              </Button>
            ) : undefined,
          }}
        />
      )}

      <ModalOverlay
        isDismissable
        isOpen={creatingList}
        onOpenChange={(open) => !open && setCreatingList(false)}
      >
        <Modal className="sm:max-w-md">
          <Dialog className="flex max-h-[inherit] flex-col">
            {creatingList && choices !== undefined ? (
              <PriceListForm
                list={null}
                currencies={choices.currencies}
                canSave={canCreate}
                onSaved={() => setCreatingList(false)}
                onCancel={() => setCreatingList(false)}
              />
            ) : null}
          </Dialog>
        </Modal>
      </ModalOverlay>

      <ModalOverlay
        isDismissable
        isOpen={creatingPromotion || editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCreatingPromotion(false);
            setEditingPromotionId(null);
          }
        }}
      >
        <Modal className="sm:max-w-lg">
          <Dialog className="flex max-h-[inherit] flex-col">
            {lists !== undefined && (creatingPromotion || editing !== null) ? (
              <PromotionForm
                key={editing?._id ?? "new"}
                promotion={editing}
                lists={lists}
                canSave={canCreate}
                onSaved={() => {
                  setCreatingPromotion(false);
                  setEditingPromotionId(null);
                }}
                onCancel={() => {
                  setCreatingPromotion(false);
                  setEditingPromotionId(null);
                }}
              />
            ) : null}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </div>
  );
}
