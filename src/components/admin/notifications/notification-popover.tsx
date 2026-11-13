"use client";

import * as React from "react";
import {
  Bell,
  CheckCheck,
  Calendar,
  Boxes,
  Banknote,
  Clock,
  Sparkles,
  ChevronRight,
  X,
} from "lucide-react";
import { useKeptResource } from "@/components/admin/team/use-kept-resource";
import type {
  AdminNotificationItem,
  AdminNotificationSummary,
  AdminNotificationTab,
} from "@/types/admin-contracts";

const STORAGE_KEY = "zeus_admin_notifications_read_at";

export function NotificationPopover({
  onNavigate,
}: {
  onNavigate: (tab: AdminNotificationTab) => void;
}) {
  const [open, setOpen] = React.useState(false);
  // Below lg the panel is fixed to the viewport; its top follows the bell, because the header's height varies as it wraps.
  const [panelTop, setPanelTop] = React.useState(64);
  const [activeFilter, setActiveFilter] = React.useState<"ALL" | "BOOKINGS" | "SUPPLIES" | "PAYROLL">("ALL");
  const [lastReadAt, setLastReadAt] = React.useState<string>(() => {
    try {
      return typeof window !== "undefined"
        ? localStorage.getItem(STORAGE_KEY) || ""
        : "";
    } catch {
      return "";
    }
  });

  const popoverRef = React.useRef<HTMLDivElement>(null);
  const resource = useKeptResource<AdminNotificationSummary>("/api/admin/notifications");
  const data = resource.data;
  const reload = resource.reload;

  // Polling every 20 seconds
  React.useEffect(() => {
    const interval = setInterval(() => {
      void reload();
    }, 20_000);

    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [reload]);

  // Click outside to close
  React.useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Unread items based on last read timestamp
  const items = data?.items ?? [];
  const lastReadTime = lastReadAt ? new Date(lastReadAt).getTime() : 0;
  const unreadItems = lastReadTime
    ? items.filter((item) => new Date(item.timestamp).getTime() > lastReadTime)
    : items;
  const unreadCount = unreadItems.length;

  const markAllRead = () => {
    const nowIso = new Date().toISOString();
    setLastReadAt(nowIso);
    try {
      localStorage.setItem(STORAGE_KEY, nowIso);
    } catch {
      // ignore storage error
    }
  };

  const filteredItems = items.filter((item) => {
    if (activeFilter === "ALL") return true;
    if (activeFilter === "BOOKINGS") {
      return item.type === "NEW_BOOKING" || item.type === "UPCOMING_BOOKING";
    }
    if (activeFilter === "SUPPLIES") {
      return item.type === "LOW_SUPPLY";
    }
    if (activeFilter === "PAYROLL") {
      return item.type === "PAYROLL_ALERT";
    }
    return true;
  });

  const handleItemClick = (item: AdminNotificationItem) => {
    setOpen(false);
    onNavigate(item.targetTab);
  };

  return (
    <div ref={popoverRef} className="relative">
      <button
        type="button"
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread alerts` : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(e) => {
          setPanelTop(Math.round(e.currentTarget.getBoundingClientRect().bottom) + 8);
          setOpen((prev) => !prev);
          if (!open) {
            void reload();
          }
        }}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-zinc-300 transition-colors hover:border-primary/40 hover:bg-zinc-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 font-mono text-xs font-bold text-black ring-2 ring-[#121214] animate-in zoom-in-50">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* P1-70: below lg the bell is not at the screen edge, so the panel is pinned to the viewport (it was clipped 187 px at 390). */}
      {open && (
        <div
          role="dialog"
          aria-label="Real-time notifications panel"
          style={{ "--panel-top": `${panelTop}px` } as React.CSSProperties}
          className="fixed inset-x-3 top-[var(--panel-top)] z-50 rounded-xl border border-border bg-panel shadow-2xl sm:left-auto sm:w-[420px] lg:absolute lg:inset-x-auto lg:right-0 lg:top-full lg:mt-2 animate-in fade-in-0 zoom-in-95"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/80 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Bell className="h-3.5 w-3.5" />
              </span>
              <div>
                <div className="flex items-center gap-1.5">
                  <h3 className="text-xs font-bold text-foreground">Notifications &amp; Alerts</h3>
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" title="Live real-time polling active" />
                </div>
                <p className="text-xs text-zinc-400">Live operational events</p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="inline-flex min-h-[32px] items-center gap-1 rounded px-2 text-xs font-semibold text-primary hover:bg-primary/10 transition-colors"
                >
                  <CheckCheck className="h-3 w-3" />
                  <span>Mark read</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded text-muted-foreground hover:bg-white/5 hover:text-foreground"
                aria-label="Close notifications"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 bg-card px-4 py-2">
            {(
              [
                ["ALL", "All"],
                ["BOOKINGS", "Bookings"],
                ["SUPPLIES", "Inventory"],
                ["PAYROLL", "Payroll"],
              ] as const
            ).map(([key, label]) => {
              const isActive = activeFilter === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveFilter(key)}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                    isActive
                      ? "bg-primary text-black font-semibold shadow-sm"
                      : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* List of Alerts */}
          <div className="max-h-[360px] overflow-y-auto divide-y divide-border/50">
            {filteredItems.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                <CheckCheck className="mx-auto h-7 w-7 text-emerald-400/60 mb-2" />
                <p className="font-semibold text-foreground">All caught up!</p>
                <p className="mt-0.5 text-zinc-400">No active alerts matching this filter.</p>
              </div>
            ) : (
              filteredItems.map((item) => {
                const isUnread = !lastReadTime || new Date(item.timestamp).getTime() > lastReadTime;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleItemClick(item)}
                    className={`w-full text-left p-3.5 transition-colors hover:bg-white/[0.04] flex items-start gap-3 group ${
                      isUnread ? "bg-primary/[0.03]" : ""
                    }`}
                  >
                    {/* Category Icon */}
                    <div className="shrink-0 mt-0.5">
                      {item.type === "NEW_BOOKING" ? (
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                          <Sparkles className="h-3.5 w-3.5" />
                        </span>
                      ) : item.type === "UPCOMING_BOOKING" ? (
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-blue-500/30 bg-blue-500/10 text-blue-400">
                          <Calendar className="h-3.5 w-3.5" />
                        </span>
                      ) : item.type === "LOW_SUPPLY" ? (
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400">
                          <Boxes className="h-3.5 w-3.5" />
                        </span>
                      ) : (
                        <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-purple-500/30 bg-purple-500/10 text-purple-400">
                          <Banknote className="h-3.5 w-3.5" />
                        </span>
                      )}
                    </div>

                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <p className="truncate text-xs font-bold text-foreground group-hover:text-primary transition-colors">
                          {item.title}
                        </p>
                        {isUnread && (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                        )}
                      </div>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground line-clamp-2">
                        {item.message}
                      </p>
                      <div className="mt-1 flex items-center justify-between text-xs text-zinc-400">
                        <span className="flex items-center gap-1">
                          <Clock className="h-2.5 w-2.5 text-zinc-400" />
                          <span>
                            {new Date(item.timestamp).toLocaleDateString("en-PH", {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </span>
                        <span className="font-semibold text-primary/80 group-hover:text-primary flex items-center">
                          Open {item.targetTab}
                          <ChevronRight className="h-3 w-3 ml-0.5" />
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-border/80 bg-card px-4 py-2 flex items-center justify-between text-xs text-zinc-400">
            <span>Updates automatically</span>
            <span className="font-mono text-xs text-zinc-400">Asia/Manila</span>
          </div>
        </div>
      )}
    </div>
  );
}
