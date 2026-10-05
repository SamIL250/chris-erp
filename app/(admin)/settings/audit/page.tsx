"use client";

import { usePaginatedQuery, useQuery } from "convex/react";
import { useState } from "react";
import { Dialog, DialogTrigger, Modal, ModalOverlay } from "@/components/application/modals/modal";
import { Badge } from "@/components/base/badges/badges";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Select } from "@/components/base/select/select";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";

/**
 * Audit log (PH0-26): every entry `auditedMutation` appended — filter by
 * actor, entity, and date range; open an entry to compare its before/after
 * snapshots (secrets are redacted server-side when the entry is written).
 */

type AuditRow = Doc<"auditLog">;

const ACTION_COLOR: Record<string, "success" | "brand" | "warning" | "error" | "gray"> = {
  create: "success",
  update: "brand",
  delete: "error",
  invite: "warning",
  roleChange: "warning",
};

const formatWhen = (timestamp: number) => new Date(timestamp).toLocaleString();
const startOfDay = (date: string) => new Date(`${date}T00:00:00`).getTime();
const endOfDay = (date: string) => new Date(`${date}T23:59:59.999`).getTime();

function Snapshot({ label, value }: { label: string; value: unknown }) {
  if (value === undefined) return null;
  return (
    <section className="space-y-1.5">
      <h3 className="text-primary text-sm font-medium">{label}</h3>
      <pre className="bg-secondary text-secondary overflow-x-auto rounded-xl p-3 text-xs whitespace-pre-wrap">
        {value === null ? "—" : JSON.stringify(value, null, 2)}
      </pre>
    </section>
  );
}

function DetailsDialog({ entry, onClose }: { entry: AuditRow | null; onClose: () => void }) {
  return (
    <DialogTrigger isOpen={entry !== null} onOpenChange={(open) => !open && onClose()}>
      <ModalOverlay>
        <Modal className="sm:max-w-lg">
          <Dialog className="flex max-h-[inherit] flex-col">
            {entry ? (
              <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto p-6">
                <div className="flex items-center gap-2">
                  <Badge color={ACTION_COLOR[entry.action] ?? "gray"} size="sm">
                    {entry.action}
                  </Badge>
                  <span className="text-secondary text-sm">
                    {entry.entity} · {formatWhen(entry.createdAt)}
                  </span>
                </div>
                <p className="text-primary text-sm font-medium">
                  {entry.actorLabel ?? "System"}
                  <span className="text-tertiary font-normal"> · {entry.entityId}</span>
                </p>
                <Snapshot label="Before" value={entry.before} />
                <Snapshot label="After" value={entry.after} />
                <Button color="secondary" size="lg" className="w-full" onPress={onClose}>
                  Close
                </Button>
              </div>
            ) : null}
          </Dialog>
        </Modal>
      </ModalOverlay>
    </DialogTrigger>
  );
}

export default function AuditLogPage() {
  const [actorId, setActorId] = useState("");
  const [entity, setEntity] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [detail, setDetail] = useState<AuditRow | null>(null);

  const actors = useQuery(api.audit.actors);
  const entities = useQuery(api.audit.entities);
  const { results, isLoading, status, loadMore } = usePaginatedQuery(
    api.audit.list,
    {
      actorId: actorId === "" ? null : (actorId as Id<"users">),
      entity: entity === "" ? null : entity,
      from: from === "" ? null : startOfDay(from),
      to: to === "" ? null : endOfDay(to),
    },
    { initialNumItems: 50 },
  );

  const hasFilters = actorId !== "" || entity !== "" || from !== "" || to !== "";

  const columns: DataTableColumn<AuditRow>[] = [
    {
      id: "when",
      header: "When",
      cell: (row) => (
        <span className="text-secondary text-sm whitespace-nowrap">
          {formatWhen(row.createdAt)}
        </span>
      ),
    },
    {
      id: "actor",
      header: "Actor",
      cell: (row) => <span className="text-primary text-sm">{row.actorLabel ?? "System"}</span>,
    },
    {
      id: "action",
      header: "Action",
      cell: (row) => (
        <Badge color={ACTION_COLOR[row.action] ?? "gray"} size="sm">
          {row.action}
        </Badge>
      ),
    },
    {
      id: "entity",
      header: "Entity",
      cell: (row) => (
        <span className="text-tertiary font-mono text-sm">
          {row.entity} · {row.entityId}
        </span>
      ),
    },
    {
      id: "details",
      header: "",
      cell: (row) => (
        <Button color="secondary" size="sm" onPress={() => setDetail(row)}>
          View
        </Button>
      ),
    },
  ];

  const filterBar = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="w-44">
        <Select
          aria-label="Filter by actor"
          size="sm"
          placeholder="All actors"
          items={[
            { id: "", label: "All actors" },
            ...(actors ?? []).map((actor) => ({ id: actor.id, label: actor.label })),
          ]}
          value={actorId}
          onChange={(key) => setActorId(key == null ? "" : String(key))}
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
          aria-label="Filter by entity"
          size="sm"
          placeholder="All entities"
          items={[
            { id: "", label: "All entities" },
            ...(entities ?? []).map((name) => ({ id: name, label: name })),
          ]}
          value={entity}
          onChange={(key) => setEntity(key == null ? "" : String(key))}
        >
          {(item) => (
            <Select.Item id={item.id} key={item.id} isDisabled={item.isDisabled}>
              {item.label}
            </Select.Item>
          )}
        </Select>
      </div>
      <div className="w-40">
        <Input aria-label="From date" size="sm" type="date" value={from} onChange={setFrom} />
      </div>
      <div className="w-40">
        <Input aria-label="To date" size="sm" type="date" value={to} onChange={setTo} />
      </div>
      {hasFilters ? (
        <Button
          color="secondary"
          size="sm"
          onPress={() => {
            setActorId("");
            setEntity("");
            setFrom("");
            setTo("");
          }}
        >
          Clear
        </Button>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        description="Who changed what, and when. Entries are appended automatically and never edited or deleted."
      />
      <DataTable
        title="Entries"
        columns={columns}
        rows={results}
        rowId={(row) => row._id}
        toolbar={filterBar}
        pagination={{
          isLoading,
          hasMore: status === "CanLoadMore",
          onLoadMore: () => loadMore(50),
        }}
        empty={{
          title: "Nothing recorded yet",
          description: hasFilters
            ? "No entries match these filters — try widening them."
            : "Changes made through audited actions will show up here.",
        }}
      />
      <DetailsDialog entry={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
