"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Boxes,
  CalendarDays,
  ClipboardList,
  Users,
  X,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { BookingsTab } from "./bookings-tab";
import { CalendarTab } from "./calendar-tab";
import { DetailersTab } from "./detailers-tab";
import { InventoryTab } from "./inventory-tab";
import { AnalyticsTab } from "./analytics-tab";

export type AdminTab =
  | "Bookings"
  | "Bay Calendar"
  | "Team & Commissions"
  | "Supplies & Inventory"
  | "Sales Analytics";

interface NavItem {
  name: AdminTab;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
}

const NAV_ITEMS: NavItem[] = [
  { name: "Bookings", icon: ClipboardList },
  { name: "Bay Calendar", icon: CalendarDays },
  { name: "Team & Commissions", icon: Users },
  { name: "Supplies & Inventory", icon: Boxes },
  { name: "Sales Analytics", icon: BarChart3 },
];

export function AdminPortal({ initialTab }: { initialTab?: AdminTab }) {
  const [tab, setTab] = React.useState<AdminTab>(initialTab ?? "Bookings");

  return (
    <div className="flex min-h-screen bg-[#09090b] text-[#f5f5f4]">
      {/* Sidebar Navigation */}
      <aside
        aria-label="Shop Management Sidebar"
        className="flex w-64 shrink-0 flex-col border-r border-border bg-[#121214] p-6"
      >
        <Link href="/" aria-label="Return to public shop site" className="mb-8">
          <Logo small />
        </Link>

        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Shop Management
        </p>

        <nav aria-label="Shop Operations Navigation" className="space-y-1">
          {NAV_ITEMS.map(({ name, icon: Icon }) => {
            const isActive = tab === name;
            return (
              <button
                type="button"
                key={name}
                onClick={() => setTab(name)}
                aria-current={isActive ? "page" : undefined}
                className={`flex w-full min-h-[44px] items-center gap-3 rounded px-3 py-2 text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary font-bold"
                    : "text-muted-foreground hover:bg-[#18181b] hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{name}</span>
              </button>
            );
          })}
        </nav>

        {/* Staff footer */}
        <div className="mt-auto border-t border-border pt-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
                JD
              </div>
              <div>
                <p className="text-xs font-bold text-foreground">Juan Dela Cruz</p>
                <p className="text-[10px] text-muted-foreground">Shop Manager</p>
              </div>
            </div>
            <Link
              href="/"
              aria-label="Exit admin portal"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </aside>

      {/* Main Admin Content */}
      <main className="flex-1 overflow-auto p-8 lg:p-10">
        <div className="mx-auto max-w-6xl">
          <header className="mb-8 flex flex-col justify-between gap-4 border-b border-border pb-6 sm:flex-row sm:items-end">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                Saturday · October 18, 2026
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                {tab}
              </h1>
            </div>

            <div className="flex items-center gap-4">
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                Shop Live
              </span>
              <Link
                href="/book"
                className="inline-flex min-h-[40px] items-center gap-2 rounded bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:bg-primary-hover"
              >
                New Booking <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
          </header>

          {/* Active Tab View */}
          {tab === "Bookings" && <BookingsTab />}
          {tab === "Bay Calendar" && <CalendarTab />}
          {tab === "Team & Commissions" && <DetailersTab />}
          {tab === "Supplies & Inventory" && <InventoryTab />}
          {tab === "Sales Analytics" && <AnalyticsTab />}
        </div>
      </main>
    </div>
  );
}
