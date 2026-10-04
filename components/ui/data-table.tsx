"use client";

/**
 * Data table pattern (PH0-10): Untitled UI table skin + Convex pagination + sort +
 * column visibility + row → detail drawer.
 *
 * Convex wiring (page side):
 *   const { items, count, isLoading, loadMore } = usePaginatedQuery(
 *     api.<domain>.list, { ...filters }, { initialNumItems: 25 });
 *   <DataTable
 *     rows={items} rowId={(r) => r._id}
 *     sort={sort} onSortChange={setSort}   // → pass `{ key: sort.key, direction: sort.direction }` as query order
 *     pagination={{ isLoading, hasMore: count === items.length && …, onLoadMore: () => loadMore(25) }}
 *   />
 *
 * Row interaction: RAC table rows are not clickable elements, so `onRowClick` is wired
 * to each *cell* for pointer UX — put a <Link>/<button> in the primary column for
 * keyboard access (required for a11y, enforced in review).
 */
import { Check, Columns01 } from "@untitledui/icons";
import { useState, type ReactNode } from "react";
import type { Selection, SortDescriptor } from "react-aria-components";
import { EmptyState } from "@/components/application/empty-state/empty-state";
import { Table, TableCard } from "@/components/application/table/table";
import { Button } from "@/components/base/buttons/button";
import { Dropdown } from "@/components/base/dropdown/dropdown";
import { Skeleton } from "@/components/ui/skeleton";
import { cx } from "@/utils/cx";

export interface DataTableColumn<T> {
  /** Unique column id — also the sort key when `sortable`. */
  id: string;
  header: string;
  /** Cell renderer. Primary column should render a Link/button for keyboard open. */
  cell: (row: T) => ReactNode;
  /** Enables click-to-sort (asc → desc → none) when `onSortChange` is provided. */
  sortable?: boolean;
  /** Right-align (money, numbers). */
  align?: "left" | "right";
  className?: string;
  /** Allow hiding via the Columns menu. @default true */
  hideable?: boolean;
}

export interface DataTableSort {
  key: string;
  direction: "ascending" | "descending";
}

export interface DataTablePagination {
  /** From `usePaginatedQuery`. */
  isLoading: boolean;
  /** Whether another `loadMore` call would return data. */
  hasMore: boolean;
  /** Loaded item count (Convex `count`). */
  count?: number;
  onLoadMore: () => void;
}

export interface DataTableProps<T extends object> {
  title: string;
  description?: string;
  badge?: ReactNode;
  /** Filters + primary action rendered in the card header (replaced while rows are selected). */
  toolbar?: ReactNode;
  columns: DataTableColumn<T>[];
  rows: T[];
  rowId: (row: T) => string;
  sort?: DataTableSort;
  onSortChange?: (sort: DataTableSort | undefined) => void;
  onRowClick?: (row: T) => void;
  pagination?: DataTablePagination;
  /** Shown when there are no rows (and not loading). */
  empty?: { title: string; description?: string; action?: ReactNode };
  /** Optional multi-select (RAC) — renders the header checkbox column. */
  selection?: {
    selectedKeys: Selection;
    onSelectionChange: (keys: Selection) => void;
    /** Rendered in the card header while a selection exists (replaces `toolbar`). */
    bulkActions?: ReactNode;
  };
  /** Row count shown while the first page loads. @default 6 */
  skeletonRows?: number;
}

export function DataTable<T extends object>({
  title,
  description,
  badge,
  toolbar,
  columns,
  rows,
  rowId,
  sort,
  onSortChange,
  onRowClick,
  pagination,
  empty,
  selection,
  skeletonRows = 6,
}: DataTableProps<T>) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const visibleColumns = columns.filter((c) => !hidden.has(c.id));
  const hideable = columns.filter((c) => c.hideable !== false);
  const isLoadingRows = !!pagination?.isLoading && rows.length === 0;
  const isEmpty = !isLoadingRows && rows.length === 0;

  const hasSelection =
    !!selection && (selection.selectedKeys === "all" || selection.selectedKeys.size > 0);

  const toggleHidden = (id: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        // Don't leave the table sorted by an invisible column.
        if (sort?.key === id) onSortChange?.(undefined);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <TableCard.Root>
      <TableCard.Header
        title={title}
        description={description}
        badge={badge}
        contentTrailing={
          hasSelection && selection?.bulkActions ? (
            selection.bulkActions
          ) : (
            <div className="flex items-center gap-2">
              {toolbar}
              {hideable.length > 1 ? (
                <Dropdown.Root>
                  <Button color="secondary" size="sm" iconLeading={Columns01}>
                    Columns
                  </Button>
                  <Dropdown.Popover>
                    <Dropdown.Menu
                      aria-label="Toggle columns"
                      onAction={(key) => toggleHidden(String(key))}
                    >
                      {hideable.map((col) => (
                        <Dropdown.Item key={col.id} id={col.id} selectionIndicator="none">
                          <span className="flex items-center gap-2">
                            {!hidden.has(col.id) ? (
                              <Check aria-hidden="true" className="text-brand-secondary size-4" />
                            ) : (
                              <span className="size-4" aria-hidden="true" />
                            )}
                            {col.header}
                          </span>
                        </Dropdown.Item>
                      ))}
                    </Dropdown.Menu>
                  </Dropdown.Popover>
                </Dropdown.Root>
              ) : null}
            </div>
          )
        }
      />

      {isEmpty ? (
        <div className="px-6 py-10">
          <EmptyState size="md">
            <EmptyState.Header>
              <EmptyState.FeaturedIcon color="gray" />
            </EmptyState.Header>
            <EmptyState.Content>
              <EmptyState.Title>{empty?.title ?? "Nothing here yet"}</EmptyState.Title>
              {empty?.description ? (
                <EmptyState.Description>{empty.description}</EmptyState.Description>
              ) : null}
            </EmptyState.Content>
            {empty?.action ? <EmptyState.Footer>{empty.action}</EmptyState.Footer> : null}
          </EmptyState>
        </div>
      ) : (
        <Table
          aria-label={title}
          selectionMode={selection ? "multiple" : "none"}
          selectedKeys={selection?.selectedKeys}
          onSelectionChange={selection?.onSelectionChange}
          sortDescriptor={
            sort ? ({ column: sort.key, direction: sort.direction } as SortDescriptor) : undefined
          }
          onSortChange={(descriptor) =>
            onSortChange?.({ key: String(descriptor.column), direction: descriptor.direction })
          }
        >
          <Table.Header columns={visibleColumns}>
            {(col: DataTableColumn<T>) => (
              <Table.Head
                id={col.id}
                allowsSorting={col.sortable && !!onSortChange}
                className={cx(
                  col.align === "right" && "text-right [&>div]:justify-end",
                  col.className,
                )}
              >
                {col.header}
              </Table.Head>
            )}
          </Table.Header>

          {isLoadingRows ? (
            <Table.Body items={undefined}>
              {Array.from({ length: skeletonRows }, (_, i) => (
                <Table.Row key={`skeleton-${i}`} id={`skeleton-${i}`}>
                  {visibleColumns.map((col) => (
                    <Table.Cell key={col.id}>
                      <Skeleton className="h-4 w-3/4" />
                    </Table.Cell>
                  ))}
                </Table.Row>
              ))}
            </Table.Body>
          ) : (
            <Table.Body items={rows}>
              {(row: T) => (
                <Table.Row key={rowId(row)} id={rowId(row)} columns={visibleColumns}>
                  {(col: DataTableColumn<T>) => (
                    <Table.Cell
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      className={cx(
                        col.align === "right" && "text-right",
                        onRowClick && "cursor-pointer",
                        col.className,
                      )}
                    >
                      {col.cell(row)}
                    </Table.Cell>
                  )}
                </Table.Row>
              )}
            </Table.Body>
          )}
        </Table>
      )}

      {pagination && (pagination.hasMore || pagination.count !== undefined) ? (
        <div className="border-tertiary flex items-center justify-between gap-4 border-t px-6 py-3">
          <span className="text-secondary text-sm">
            {pagination.count !== undefined
              ? `${pagination.count} row${pagination.count === 1 ? "" : "s"}`
              : ""}
          </span>
          {pagination.hasMore ? (
            <Button
              color="secondary"
              size="sm"
              isLoading={pagination.isLoading}
              onPress={pagination.onLoadMore}
            >
              Load more
            </Button>
          ) : null}
        </div>
      ) : null}
    </TableCard.Root>
  );
}
