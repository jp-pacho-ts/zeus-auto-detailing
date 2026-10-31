"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Boxes,
  ClipboardList,
  Columns3,
  Users,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { BookingsTab } from "./bookings-tab";
import { BayWorkspace } from "./bay-workspace";
import { DetailersTab } from "./detailers-tab";
import { InventoryTab } from "./inventory-tab";
import { AnalyticsTab } from "./analytics-tab";
import type { StaffSessionView } from "@/server/auth/types";
import { adminRequest } from "./bookings/client";
import { LoadState, useAdminResource } from "./bookings/use-admin-resource";
import { brandConfig } from "@/config/brand";

export type AdminTab =
  | "Bookings"
  | "Bay Calendar"
  | "Bay board"
  | "Team & Commissions"
  | "Supplies & Inventory"
  | "Sales Analytics";

interface NavItem {
  name: AdminTab;
  icon: React.ComponentType<{
    className?: string;
    "aria-hidden"?: boolean | "true" | "false";
  }>;
}

const NAV_ITEMS: NavItem[] = [
  { name: "Bookings", icon: ClipboardList },
  { name: "Bay board", icon: Columns3 },
  { name: "Team & Commissions", icon: Users },
  { name: "Supplies & Inventory", icon: Boxes },
  { name: "Sales Analytics", icon: BarChart3 },
];

export function AdminPortal({ initialTab }: { initialTab?: AdminTab }) {
  const [tab, setTab] = React.useState<AdminTab>(
    NAV_ITEMS.some((n) => n.name === initialTab) ? initialTab! : "Bookings",
  );
  const session = useAdminResource<StaffSessionView>("/api/admin/auth/session");
  const [signingOut, setSigningOut] = React.useState(false),
    [logoutError, setLogoutError] = React.useState<string | null>(null);
  const leaving = React.useRef(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuButton = React.useRef<HTMLButtonElement>(null),
    firstNavItem = React.useRef<HTMLButtonElement>(null),
    navigation = React.useRef<HTMLElement>(null),
    menuWasOpen = React.useRef(false);
  const closeMenu = React.useCallback(() => setMenuOpen(false), []);
  React.useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    if (!menuOpen) {
      if (menuWasOpen.current && !desktop.matches) menuButton.current?.focus();
      menuWasOpen.current = false;
      return;
    }
    menuWasOpen.current = true;
    firstNavItem.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeMenu();
      } else if (e.key === "Tab") {
        const controls = Array.from(navigation.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? []).filter((element) => element.getClientRects().length > 0);
        const first = controls[0], last = controls.at(-1);
        if (document.activeElement === (e.shiftKey ? first : last)) {
          e.preventDefault();
          (e.shiftKey ? last : first)?.focus();
        }
      }
    };
    const onResize = () => {
      if (desktop.matches) {
        closeMenu();
        firstNavItem.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    desktop.addEventListener("change", onResize);
    return () => {
      document.removeEventListener("keydown", onKey);
      desktop.removeEventListener("change", onResize);
    };
  }, [menuOpen, closeMenu]);
  React.useEffect(() => {
    const refresh = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", refresh);
    return () => window.removeEventListener("pageshow", refresh);
  }, []);
  async function signOut() {
    if (leaving.current) return;
    leaving.current = true;
    setSigningOut(true);
    setLogoutError(null);
    session.setData(null);
    try {
      await adminRequest("/api/admin/auth/logout", {
        method: "POST",
        body: {},
      });
      window.location.replace("/admin/login");
    } catch {
      setLogoutError(
        "Sign-out could not be confirmed. Retry to close your session.",
      );
      leaving.current = false;
    }
  }
  if (signingOut)
    return (
      <main className="min-h-screen bg-[#09090b] p-6 text-foreground">
        <p role="status">Signing out...</p>
        {logoutError && (
          <div role="alert">
            {logoutError}
            <button
              className="ml-3 min-h-[44px] underline"
              onClick={() => void signOut()}
            >
              Retry sign-out
            </button>
          </div>
        )}
      </main>
    );
  if (!session.data)
    return (
      <main className="min-h-screen bg-[#09090b] p-6 text-foreground">
        <LoadState
          loading={session.loading}
          error={session.error}
          retry={session.reload}
        />
      </main>
    );
  const staff = session.data;

  // P1-20: one screen tall. The sidebar (a drawer below md) and the header stay in place and
  // only #admin-content scrolls; nothing in the dashboard scrolls sideways.
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#09090b] text-[#f5f5f4] md:flex-row">
      <div inert={menuOpen} className="flex shrink-0 items-center justify-between border-b border-border bg-[#121214] px-4 py-2 md:hidden">
        <Link href="/" aria-label="Return to public shop site">
          <Logo small />
        </Link>
        <button
          ref={menuButton}
          type="button"
          aria-controls="admin-nav"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
          className="inline-flex min-h-[44px] items-center gap-2 rounded px-3 text-sm font-medium text-foreground hover:bg-[#18181b] focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Menu className="h-5 w-5" aria-hidden="true" /> Menu
        </button>
      </div>
      {menuOpen && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          onClick={closeMenu}
        />
      )}

      {/* Sidebar Navigation */}
      <aside
        ref={navigation}
        role={menuOpen ? "dialog" : undefined}
        aria-modal={menuOpen ? true : undefined}
        id="admin-nav"
        aria-label="Shop Management Sidebar"
        className={`${menuOpen ? "flex" : "hidden"} fixed inset-y-0 left-0 z-40 w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-border bg-[#121214] p-6 md:static md:z-auto md:flex md:w-64 md:max-w-none md:shrink-0`}
      >
        <div className="mb-8 flex items-center justify-between">
          <Link href="/" aria-label="Return to public shop site">
            <Logo small />
          </Link>
          <button
            type="button"
            aria-label="Close menu"
            onClick={closeMenu}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary md:hidden"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Shop Management
        </p>

        <nav aria-label="Shop Operations Navigation" className="space-y-1">
          {NAV_ITEMS.map(({ name, icon: Icon }, i) => {
            const isActive = tab === name;
            return (
              <button
                type="button"
                key={name}
                ref={i === 0 ? firstNavItem : undefined}
                onClick={() => {
                  setTab(name);
                  if (menuOpen) closeMenu();
                }}
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
                {staff.displayName
                  .split(/\s+/)
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join("")}
              </div>
              <div>
                <p className="text-xs font-bold text-foreground">
                  {staff.displayName}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {staff.role === "ADMIN" ? "Shop Manager" : "Shop Staff"}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void signOut()}
              className="inline-flex min-h-[44px] shrink-0 items-center gap-2 whitespace-nowrap text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
            </button>
          </div>
        </div>
      </aside>

      {/* Main Admin Content */}
      <div inert={menuOpen} className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="shrink-0 border-b border-border px-4 py-4 sm:px-8 lg:px-10 lg:py-6">
          <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                {new Intl.DateTimeFormat(brandConfig.locale, {
                  timeZone: brandConfig.timezone,
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                }).format(new Date())}
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
                New Booking{" "}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </header>

        <main
          id="admin-content"
          tabIndex={-1}
          className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-6 focus:outline-none sm:px-8 lg:px-10 lg:py-8"
        >
          <div className="mx-auto max-w-6xl">
            {/* Active Tab View */}
            {tab === "Bookings" && (
              <BookingsTab role={staff.role} initialView={initialTab === "Bay Calendar" ? "CALENDAR" : "BOOKINGS"} />
            )}
            {tab === "Bay board" && <BayWorkspace role={staff.role} />}
            {tab === "Team & Commissions" && <DetailersTab />}
            {tab === "Supplies & Inventory" && <InventoryTab />}
            {tab === "Sales Analytics" && <AnalyticsTab />}
          </div>
        </main>
      </div>
    </div>
  );
}
