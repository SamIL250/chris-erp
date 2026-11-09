"use client";

import { Check, Image01, SearchSm } from "@untitledui/icons";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Selection } from "react-aria-components";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Dropdown } from "@/components/base/dropdown/dropdown";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { DataTable, type DataTableColumn, type DataTableSort } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { toast } from "@/components/ui/toast";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useCan } from "@/hooks/use-can";
import { toUserMessage } from "@/lib/errors";

/**
 * Product list (PH1-08): the catalog's reactive table.
 *
 * - Filtering, search (name/SKU/barcode substring), column sort and the
 *   page window are SERVER-side (`catalog/products:list`) — the Convex
 *   query re-runs on every product write, so the table stays live.
 * - The brand dropdown comes from `catalog/products:brands` (distinct
 *   values); category options reuse `catalog/categories:list`. Filter
 *   changes reset the page window and clear the selection.
 * - Bulk status change (Activate / Set draft / Set archived) appears only
 *   with `catalog.edit`, mirrors the server ladder, and reports
 *   updated/already counts from the mutation result.
 * - Rows open the PH1-07 editor: a Link in the primary cell (keyboard)
 *   plus `onRowClick` for pointer users.
 */

type ProductRow = Doc<"products">;
/** Product plus the resolved cover. A new object is required once the URL arrives — see `tableRows`. */
type ProductTableRow = ProductRow & { coverSrc: string | null };
type StatusKey = "draft" | "active" | "archived";
type SortKey = "name" | "sku" | "brand" | "status" | "updatedAt";
type ListSort = { key: SortKey; direction: "asc" | "desc" };
type FlagKey =
  "serialTracked" | "lotTracked" | "expiryRequired" | "warrantyEligible" | "allowBackorder";

const STATUS: Record<StatusKey, { label: string; color: "success" | "warning" | "gray" }> = {
  active: { label: "Active", color: "success" },
  draft: { label: "Draft", color: "warning" },
  archived: { label: "Archived", color: "gray" },
};

/** Tracking-flag filters (AND) — `short` is the column badge label. */
const FLAGS: { key: FlagKey; label: string; short: string }[] = [
  { key: "serialTracked", label: "Serial tracked", short: "Serial" },
  { key: "lotTracked", label: "Lot tracked", short: "Lot" },
  { key: "expiryRequired", label: "Expiry required", short: "Expiry" },
  { key: "warrantyEligible", label: "Warranty eligible", short: "Warranty" },
  { key: "allowBackorder", label: "Backorders allowed", short: "Backorder" },
];

const SORT_KEYS: readonly SortKey[] = ["name", "sku", "brand", "status", "updatedAt"];
const isSortKey = (key: string): key is SortKey => SORT_KEYS.includes(key as SortKey);

const PAGE_SIZE = 50;

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function ProductsPage() {
  const router = useRouter();
  const canCreate = useCan("catalog", "create");
  const canEdit = useCan("catalog", "edit");

  // Filter state — `search` is the debounced value the query runs on.
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [brand, setBrand] = useState("");
  const [status, setStatus] = useState("");
  const [flags, setFlags] = useState<ReadonlySet<FlagKey>>(new Set());
  const [sort, setSort] = useState<ListSort | undefined>();
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<Selection>(new Set());

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setLimit(PAGE_SIZE);
      setSelected(new Set());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const categories = useQuery(api.catalog.categories.list);
  const brands = useQuery(api.catalog.products.brands);
  const result = useQuery(api.catalog.products.list, {
    search,
    ...(categoryId === "" ? {} : { categoryId: categoryId as Id<"categories"> }),
    ...(brand === "" ? {} : { brand }),
    ...(status === "" ? {} : { status: status as StatusKey }),
    flags: [...flags],
    ...(sort === undefined ? {} : { sort }),
    limit,
  });
  const bulkStatus = useMutation(api.catalog.products.bulkStatus);

  // Cover thumbnails (PH1-13): index 0 is the cover. One batched URL
  // lookup for the visible page — products with no images stay a placeholder.
  const coverIds = useMemo(() => {
    const ids: Id<"files">[] = [];
    for (const row of result?.rows ?? []) {
      const cover = row.images?.[0]?.fileId;
      if (cover !== undefined) ids.push(cover);
    }
    return ids;
  }, [result]);
  const coverUrls = useQuery(api.files.urls, coverIds.length > 0 ? { fileIds: coverIds } : "skip");
  // React Aria caches a row element by the item object's identity and will not
  // rerun the cell when only a closed-over URL arrives later. Copying the row
  // once `coverSrc` resolves gives the table a new item, so the thumbnail paints.
  const tableRows = useMemo((): ProductTableRow[] => {
    const list = result?.rows ?? [];
    return list.map((row) => {
      const fileId = row.images?.[0]?.fileId;
      const coverSrc =
        fileId === undefined
          ? null
          : (coverUrls?.find((entry) => entry.fileId === fileId)?.url ?? null);
      return { ...row, coverSrc };
    });
  }, [result, coverUrls]);

  const categoryName = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of categories ?? []) map.set(row._id, row.name);
    return map;
  }, [categories]);

  // Changing a filter rewinds the page window and drops the selection so
  // bulk actions can't target rows the user can no longer see.
  const resetView = () => {
    setLimit(PAGE_SIZE);
    setSelected(new Set());
  };

  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setCategoryId("");
    setBrand("");
    setStatus("");
    setFlags(new Set());
    resetView();
  };

  const hasFilters =
    search !== "" || categoryId !== "" || brand !== "" || status !== "" || flags.size > 0;

  const tableSort: DataTableSort | undefined =
    sort === undefined
      ? undefined
      : { key: sort.key, direction: sort.direction === "asc" ? "ascending" : "descending" };

  const selectedIds: Id<"products">[] =
    selected === "all"
      ? (result?.rows.map((row) => row._id) ?? [])
      : [...selected].filter((key): key is Id<"products"> => typeof key === "string");
  const selectedCount = selected === "all" ? (result?.rows.length ?? 0) : selected.size;

  const applyStatus = async (next: StatusKey) => {
    if (selectedIds.length === 0) return;
    try {
      const { updated, unchanged } = await bulkStatus({ ids: selectedIds, status: next });
      const label = STATUS[next].label;
      const parts = [`${updated} product${updated === 1 ? "" : "s"} set to ${label}`];
      if (unchanged > 0) parts.push(`${unchanged} already ${label}`);
      toast.success(parts.join(" · "));
      setSelected(new Set());
    } catch (error) {
      toast.error(toUserMessage(error));
    }
  };

  const columns: DataTableColumn<ProductTableRow>[] = [
    {
      id: "name",
      header: "Product",
      sortable: true,
      cell: (row) => {
        const imageCount = row.images?.length ?? 0;
        return (
          <div className="flex min-w-0 items-center gap-3">
            <div className="bg-secondary ring-secondary relative size-10 shrink-0 overflow-hidden rounded-lg ring-1">
              {row.coverSrc ? (
                // Cover delivery URL. The product name next to it is the accessible name.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={row.coverSrc} alt="" className="size-full object-cover" />
              ) : (
                <div className="flex size-full items-center justify-center">
                  <Image01 className="text-fg-tertiary size-4" aria-hidden="true" />
                </div>
              )}
              {imageCount > 1 ? (
                <span className="bg-primary/90 text-secondary absolute right-0.5 bottom-0.5 rounded px-1 text-[10px] leading-4 font-medium">
                  +{imageCount - 1}
                </span>
              ) : null}
            </div>
            <div className="min-w-0">
              <Link
                href={`/catalog/products/${row._id}`}
                className="text-primary block truncate text-sm font-medium hover:underline"
              >
                {row.name}
              </Link>
              <span className="text-tertiary block truncate font-mono text-xs">{row.slug}</span>
            </div>
          </div>
        );
      },
    },
    {
      id: "sku",
      header: "SKU",
      sortable: true,
      cell: (row) => <span className="text-secondary font-mono text-sm">{row.sku}</span>,
    },
    {
      id: "brand",
      header: "Brand",
      sortable: true,
      cell: (row) =>
        row.brand !== undefined && row.brand !== "" ? (
          <span className="text-secondary text-sm">{row.brand}</span>
        ) : (
          <span className="text-tertiary text-sm">—</span>
        ),
    },
    {
      id: "status",
      header: "Status",
      sortable: true,
      cell: (row) => (
        <Badge color={STATUS[row.status].color} size="sm">
          {STATUS[row.status].label}
        </Badge>
      ),
    },
    {
      id: "categories",
      header: "Categories",
      cell: (row) => {
        if (categories === undefined) return null;
        const names = row.categoryIds
          .map((id) => categoryName.get(id))
          .filter((name): name is string => name !== undefined);
        return names.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {names.map((name) => (
              <Badge key={name} color="gray" size="sm">
                {name}
              </Badge>
            ))}
          </span>
        ) : (
          <span className="text-tertiary text-sm">—</span>
        );
      },
    },
    {
      id: "flags",
      header: "Flags",
      cell: (row) => {
        const active = FLAGS.filter((flag) => row[flag.key] === true);
        return active.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {active.map((flag) => (
              <Badge key={flag.key} color="gray" size="sm">
                {flag.short}
              </Badge>
            ))}
          </span>
        ) : (
          <span className="text-tertiary text-sm">—</span>
        );
      },
    },
    {
      id: "updatedAt",
      header: "Updated",
      sortable: true,
      cell: (row) => (
        <span className="text-secondary text-sm whitespace-nowrap">
          {formatDate(row.updatedAt)}
        </span>
      ),
    },
  ];

  const newProductButton = canCreate ? (
    <Button color="primary" onPress={() => router.push("/catalog/products/new")}>
      New product
    </Button>
  ) : null;

  const filterBar = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="w-56">
        <Input
          aria-label="Search products"
          size="sm"
          icon={SearchSm}
          placeholder="Search name, SKU, barcode…"
          value={searchInput}
          onChange={setSearchInput}
        />
      </div>
      <div className="w-44">
        <Select
          aria-label="Filter by category"
          size="sm"
          placeholder="All categories"
          items={[
            { id: "", label: "All categories" },
            ...(categories ?? []).map((row) => ({
              id: row._id as string,
              label: `${"— ".repeat(row.depth - 1)}${row.name}`,
            })),
          ]}
          value={categoryId}
          onChange={(key) => {
            setCategoryId(key == null ? "" : String(key));
            resetView();
          }}
        >
          {(item) => (
            <Select.Item id={item.id} key={item.id} isDisabled={item.isDisabled}>
              {item.label}
            </Select.Item>
          )}
        </Select>
      </div>
      <div className="w-40">
        <Select
          aria-label="Filter by brand"
          size="sm"
          placeholder="All brands"
          items={[
            { id: "", label: "All brands" },
            ...(brands ?? []).map((name) => ({ id: name, label: name })),
          ]}
          value={brand}
          onChange={(key) => {
            setBrand(key == null ? "" : String(key));
            resetView();
          }}
        >
          {(item) => (
            <Select.Item id={item.id} key={item.id} isDisabled={item.isDisabled}>
              {item.label}
            </Select.Item>
          )}
        </Select>
      </div>
      <div className="w-36">
        <Select
          aria-label="Filter by status"
          size="sm"
          placeholder="Active and draft"
          items={[
            { id: "", label: "Active and draft" },
            ...(["active", "draft", "archived"] as StatusKey[]).map((key) => ({
              id: key,
              label: STATUS[key].label,
            })),
          ]}
          value={status}
          onChange={(key) => {
            setStatus(key == null ? "" : String(key));
            resetView();
          }}
        >
          {(item) => (
            <Select.Item id={item.id} key={item.id} isDisabled={item.isDisabled}>
              {item.label}
            </Select.Item>
          )}
        </Select>
      </div>
      <Dropdown.Root>
        <Button color="secondary" size="sm">
          Flags{flags.size > 0 ? ` (${flags.size})` : ""}
        </Button>
        <Dropdown.Popover>
          <Dropdown.Menu
            aria-label="Filter by tracking flags"
            onAction={(key) => {
              const flag = FLAGS.find((candidate) => candidate.key === key);
              if (flag === undefined) return;
              setFlags((previous) => {
                const next = new Set(previous);
                if (next.has(flag.key)) next.delete(flag.key);
                else next.add(flag.key);
                return next;
              });
              resetView();
            }}
          >
            {FLAGS.map((flag) => (
              <Dropdown.Item key={flag.key} id={flag.key} selectionIndicator="none">
                <span className="flex items-center gap-2">
                  {flags.has(flag.key) ? (
                    <Check aria-hidden="true" className="text-brand-secondary size-4" />
                  ) : (
                    <span className="size-4" aria-hidden="true" />
                  )}
                  {flag.label}
                </span>
              </Dropdown.Item>
            ))}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown.Root>
      {hasFilters ? (
        <Button color="secondary" size="sm" onPress={clearFilters}>
          Clear
        </Button>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        description="Active and draft products. Archived items stay out of pickers until you filter by Archived."
        actions={newProductButton}
      />
      <DataTable
        title="All products"
        columns={columns}
        rows={tableRows}
        rowId={(row) => row._id}
        toolbar={filterBar}
        sort={tableSort}
        onSortChange={(next) => {
          setSort(
            next !== undefined && isSortKey(next.key)
              ? { key: next.key, direction: next.direction === "ascending" ? "asc" : "desc" }
              : undefined,
          );
          resetView();
        }}
        onRowClick={(row) => router.push(`/catalog/products/${row._id}`)}
        pagination={{
          isLoading: result === undefined,
          hasMore: result !== undefined && result.rows.length < result.total,
          count: result?.total,
          onLoadMore: () => setLimit((value) => value + PAGE_SIZE),
        }}
        selection={
          canEdit
            ? {
                selectedKeys: selected,
                onSelectionChange: setSelected,
                bulkActions: (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-secondary text-sm font-medium">
                      {selectedCount} selected
                    </span>
                    <Button color="secondary" size="sm" onPress={() => applyStatus("active")}>
                      Set active
                    </Button>
                    <Button color="secondary" size="sm" onPress={() => applyStatus("draft")}>
                      Set draft
                    </Button>
                    <Button color="secondary" size="sm" onPress={() => applyStatus("archived")}>
                      Set archived
                    </Button>
                    <Button color="tertiary" size="sm" onPress={() => setSelected(new Set())}>
                      Clear
                    </Button>
                  </div>
                ),
              }
            : undefined
        }
        empty={{
          title: hasFilters ? "No products match" : "No products yet",
          description: hasFilters
            ? "Try clearing a filter or searching for something else."
            : canCreate
              ? "Create your first product to get started."
              : "Products added by an editor will appear here.",
          action: hasFilters ? (
            <Button color="secondary" onPress={clearFilters}>
              Clear filters
            </Button>
          ) : (
            newProductButton
          ),
        }}
      />
    </div>
  );
}
