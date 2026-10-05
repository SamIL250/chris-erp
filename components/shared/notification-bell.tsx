"use client";

import { Bell01 } from "@untitledui/icons";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button as AriaButton } from "react-aria-components";
import { Dropdown } from "@/components/base/dropdown/dropdown";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { cx } from "@/utils/cx";

/** Short relative age: "just now" → "5m ago" → "3h ago" → "2d ago" → date. */
function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

/**
 * Header bell (PH0-28): unread count, latest notifications, deep-link rows.
 * Opening the popover never changes read state — clicking a row marks just
 * that row read (and navigates when it carries an `href`); "Mark all as
 * read" is explicit.
 */
export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const unreadCount = useQuery(api.notifications.countUnread);
  const { results, isLoading, status, loadMore } = usePaginatedQuery(
    api.notifications.list,
    {},
    { initialNumItems: 10 },
  );
  const markRead = useMutation(api.notifications.markRead);
  const markAllRead = useMutation(api.notifications.markAllRead);

  const openItem = (notification: Doc<"notifications">) => {
    void markRead({ ids: [notification._id] });
    setOpen(false);
    if (notification.href) router.push(notification.href);
  };

  return (
    <Dropdown.Root isOpen={open} onOpenChange={setOpen}>
      <AriaButton
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"}
        className="text-secondary hover:bg-secondary_hover outline-focus-ring relative rounded-lg p-2 focus-visible:outline-2"
      >
        <Bell01 className="size-5" />
        {unreadCount ? (
          <span className="bg-error-solid absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold text-white">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </AriaButton>

      <Dropdown.Popover placement="bottom end" className="w-80 p-0">
        <div className="border-secondary flex items-center justify-between border-b px-4 py-3">
          <span className="text-primary text-sm font-semibold">Notifications</span>
          {unreadCount ? (
            <button
              type="button"
              onClick={() => void markAllRead()}
              className="text-brand-600 cursor-pointer text-xs font-medium hover:underline"
            >
              Mark all as read
            </button>
          ) : null}
        </div>

        <ul className="max-h-96 overflow-y-auto">
          {isLoading && results.length === 0
            ? [0, 1, 2].map((i) => (
                <li key={i} className="px-4 py-3">
                  <Skeleton className="h-10" />
                </li>
              ))
            : null}
          {!isLoading && results.length === 0 ? (
            <li className="text-secondary px-4 py-6 text-center text-sm">No notifications yet</li>
          ) : null}
          {results.map((notification) => (
            <li key={notification._id}>
              <button
                type="button"
                onClick={() => openItem(notification)}
                className="hover:bg-secondary_hover focus-visible:bg-secondary_hover flex w-full cursor-pointer gap-3 px-4 py-3 text-left"
              >
                <span
                  className={cx(
                    "mt-1.5 size-1.5 shrink-0 rounded-full",
                    notification.readAt === undefined && "bg-brand-solid",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={cx(
                      "block text-sm",
                      notification.readAt === undefined
                        ? "text-primary font-medium"
                        : "text-secondary",
                    )}
                  >
                    {notification.title}
                  </span>
                  {notification.body ? (
                    <span className="text-tertiary block truncate text-xs">
                      {notification.body}
                    </span>
                  ) : null}
                  <span className="text-tertiary mt-0.5 block text-xs">
                    {timeAgo(notification.createdAt)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>

        {status === "CanLoadMore" ? (
          <button
            type="button"
            onClick={() => loadMore(10)}
            className="text-brand-600 hover:bg-secondary_hover border-secondary w-full cursor-pointer border-t px-4 py-2.5 text-xs font-medium hover:underline"
          >
            Show more
          </button>
        ) : null}
      </Dropdown.Popover>
    </Dropdown.Root>
  );
}
