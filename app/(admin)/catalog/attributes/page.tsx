"use client";

import { useQuery } from "convex/react";
import { useState } from "react";
import { EmptyState } from "@/components/application/empty-state/empty-state";
import { Button } from "@/components/base/buttons/button";
import { DefinitionPanel, EntityRow, SetPanel } from "@/components/catalog/attribute-panels";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCan } from "@/hooks/use-can";
import { ATTRIBUTE_TYPE_LABELS } from "@/lib/schemas/attributes";

/**
 * Attributes admin (PH1-04): one page for both halves of the system —
 * the definitions (name/type/unit/options) and the sets that group them
 * and pick which categories inherit them (products in those categories
 * get every field — resolved by `attributes.forCategory` in PH1-07).
 *
 * Two list cards on the left, a persistent side editor on the right
 * (same interaction model as /catalog/categories). Permission gating
 * mirrors the server: create/edit/delete buttons hide without
 * `catalog.*`, and view-only roles get read-only panels (PH1-02 pattern).
 */

type PanelState =
  | { kind: "definition"; mode: "create" }
  | { kind: "definition"; mode: "edit"; id: Id<"attributeDefinitions"> }
  | { kind: "set"; mode: "create" }
  | { kind: "set"; mode: "edit"; id: Id<"attributeSets"> };

function ListCard({
  title,
  description,
  action,
  isEmpty,
  emptyTitle,
  emptyDescription,
  emptyAction,
  children,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  isEmpty: boolean;
  emptyTitle: string;
  emptyDescription: string;
  emptyAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <div className="border-tertiary flex items-start justify-between gap-4 border-b px-6 py-4">
        <div className="min-w-0">
          <h2 className="text-primary text-md font-semibold">{title}</h2>
          <p className="text-secondary mt-0.5 text-sm">{description}</p>
        </div>
        {action}
      </div>
      {isEmpty ? (
        <div className="px-6 py-8">
          <EmptyState size="md">
            <EmptyState.Content>
              <EmptyState.Title>{emptyTitle}</EmptyState.Title>
              <EmptyState.Description>{emptyDescription}</EmptyState.Description>
            </EmptyState.Content>
            {emptyAction ? <EmptyState.Footer>{emptyAction}</EmptyState.Footer> : null}
          </EmptyState>
        </div>
      ) : (
        <div className="space-y-0.5 p-2">{children}</div>
      )}
    </Card>
  );
}

export default function AttributesPage() {
  const definitions = useQuery(api.catalog.attributes.list);
  const sets = useQuery(api.catalog.attributeSets.list);
  const categories = useQuery(api.catalog.categories.list);
  const canCreate = useCan("catalog", "create");
  const canEdit = useCan("catalog", "edit");
  const canDelete = useCan("catalog", "delete");
  const [panel, setPanel] = useState<PanelState | null>(null);

  if (definitions === undefined || sets === undefined || categories === undefined) {
    return (
      <div className="flex max-w-6xl flex-col gap-6">
        <PageHeader
          title="Attributes"
          description="Definitions and the sets that group them — categories pick up a set's fields automatically."
        />
        <Skeleton className="h-96" />
      </div>
    );
  }

  const newDefinition = () => setPanel({ kind: "definition", mode: "create" });
  const newSet = () => setPanel({ kind: "set", mode: "create" });

  const selectedDefinitionId =
    panel?.kind === "definition" && panel.mode === "edit" ? panel.id : null;
  const selectedSetId = panel?.kind === "set" && panel.mode === "edit" ? panel.id : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attributes"
        description="Definitions and the sets that group them — categories pick up a set's fields automatically."
        actions={
          canCreate ? (
            <div className="flex gap-3">
              <Button color="secondary" onPress={newDefinition}>
                New attribute
              </Button>
              <Button color="primary" onPress={newSet}>
                New set
              </Button>
            </div>
          ) : null
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] xl:grid-cols-[minmax(0,1fr)_28rem]">
        <div className="space-y-6">
          <ListCard
            title="Definitions"
            description="The individual spec fields — type decides the input products get."
            isEmpty={definitions.length === 0}
            emptyTitle="No attributes yet"
            emptyDescription={
              canCreate
                ? "Create the fields products carry — e.g. Weight (number), Color (select)."
                : "An administrator can create attribute definitions from this page."
            }
            emptyAction={
              canCreate ? (
                <Button color="primary" size="sm" onPress={newDefinition}>
                  New attribute
                </Button>
              ) : null
            }
          >
            {definitions.map((row) => (
              <EntityRow
                key={row._id}
                selected={selectedDefinitionId === row._id}
                name={row.name}
                meta={
                  [
                    ...(row.unit ? [row.unit] : []),
                    ...(row.options.length > 0
                      ? [`${row.options.length} option${row.options.length === 1 ? "" : "s"}`]
                      : []),
                  ].join(" · ") || undefined
                }
                badge={ATTRIBUTE_TYPE_LABELS[row.type]}
                onClick={() => setPanel({ kind: "definition", mode: "edit", id: row._id })}
              />
            ))}
          </ListCard>

          <ListCard
            title="Attribute sets"
            description="Groups a category opts into — its products inherit every attribute listed."
            isEmpty={sets.length === 0}
            emptyTitle="No attribute sets yet"
            emptyDescription={
              canCreate
                ? "Group definitions (e.g. Physical specs) and choose the categories that inherit them."
                : "An administrator can create attribute sets from this page."
            }
            emptyAction={
              canCreate ? (
                <Button color="primary" size="sm" onPress={newSet}>
                  New set
                </Button>
              ) : null
            }
          >
            {sets.map((row) => (
              <EntityRow
                key={row._id}
                selected={selectedSetId === row._id}
                name={row.name}
                meta={`${row.attributeIds.length} attribute${row.attributeIds.length === 1 ? "" : "s"} · ${row.categoryIds.length} categor${row.categoryIds.length === 1 ? "y" : "ies"}`}
                onClick={() => setPanel({ kind: "set", mode: "edit", id: row._id })}
              />
            ))}
          </ListCard>
        </div>

        <div className="lg:sticky lg:top-6">
          {panel === null ? (
            <Card>
              <div className="space-y-3 p-6">
                <h2 className="text-md text-primary font-semibold">Edit an attribute or set</h2>
                <p className="text-secondary text-sm">
                  Pick a row to edit it here — or create a definition, then group it into a set.
                </p>
                {canCreate ? (
                  <div className="flex gap-3">
                    <Button color="secondary" size="sm" onPress={newDefinition}>
                      New attribute
                    </Button>
                    <Button color="primary" size="sm" onPress={newSet}>
                      New set
                    </Button>
                  </div>
                ) : (
                  <p className="text-tertiary text-sm">
                    You can view the catalog but not change it.
                  </p>
                )}
              </div>
            </Card>
          ) : panel.kind === "definition" ? (
            <DefinitionPanel
              key={panel.mode === "edit" ? panel.id : "definition:create"}
              mode={panel.mode}
              definition={
                panel.mode === "edit"
                  ? (definitions.find((row) => row._id === panel.id) ?? null)
                  : null
              }
              canEdit={canEdit}
              canDelete={canDelete}
              onClose={() => setPanel(null)}
              onCreated={(id) => setPanel({ kind: "definition", mode: "edit", id })}
            />
          ) : (
            <SetPanel
              key={panel.mode === "edit" ? panel.id : "set:create"}
              mode={panel.mode}
              set={
                panel.mode === "edit" ? (sets.find((row) => row._id === panel.id) ?? null) : null
              }
              definitions={definitions}
              categories={categories}
              canEdit={canEdit}
              canDelete={canDelete}
              onClose={() => setPanel(null)}
              onCreated={(id) => setPanel({ kind: "set", mode: "edit", id })}
            />
          )}
        </div>
      </div>
    </div>
  );
}
