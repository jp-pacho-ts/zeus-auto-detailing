"use client";

import * as React from "react";
import Link from "next/link";
import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  BarChart3,
  Boxes,
  ChevronDown,
  ExternalLink,
  Wallet,
  ClipboardList,
  Columns3,
  Users,
  UserCog,
  KeyRound,
  LogOut,
  Settings,
  Sparkles,
  Menu,
  X,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { BookingsTab } from "./bookings-tab";
import { BayWorkspace } from "./bay-workspace";
import { ServicesTab } from "./services-tab";
import { DetailersTab } from "./detailers-tab";
import { InventoryTab } from "./inventory-tab";
import { ExpensesTab } from "./expenses-tab";
import { AnalyticsTab } from "./analytics-tab";
import { SettingsTab } from "./settings-tab";
import { UsersTab } from "./users-tab";
import { ChangePasswordDialog } from "./change-password-dialog";
import { MAINTENANCE_BANNER } from "./settings/settings-model";
import { useKeptResource } from "./team/use-kept-resource";
import type { StaffSessionView } from "@/server/auth/types";
import type { AdminShopSettings } from "@/types/admin-contracts";
import { adminRequest } from "./bookings/client";
import { LoadState, useAdminResource } from "./bookings/use-admin-resource";
import { brandConfig } from "@/config/brand";

export type AdminTab =
  | "Bookings"
  | "Bay Calendar"
  | "Bay board"
  | "Services"
  | "Team & Commissions"
  | "Supplies & Inventory"
  | "Expenses"
  | "Sales Analytics"
  | "Users"
  | "Settings";

interface NavItem {
  name: AdminTab;
  icon: React.ComponentType<{
    className?: string;
    "aria-hidden"?: boolean | "true" | "false";
  }>;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { name: "Bookings", icon: ClipboardList },
  { name: "Bay board", icon: Columns3 },
  { name: "Services", icon: Sparkles },
  { name: "Team & Commissions", icon: Users },
  { name: "Supplies & Inventory", icon: Boxes },
  { name: "Expenses", icon: Wallet },
  { name: "Sales Analytics", icon: BarChart3 },
  { name: "Users", icon: UserCog, adminOnly: true },
  { name: "Settings", icon: Settings },
];

export function AdminPortal({ initialTab }: { initialTab?: AdminTab }) {
  const [tab, setTab] = React.useState<AdminTab>(
    NAV_ITEMS.some((n) => n.name === initialTab) ? initialTab! : "Bookings",
  );
  const session = useAdminResource<StaffSessionView>("/api/admin/auth/session");
  // The banner: a site left in maintenance must be impossible to miss on any admin screen.
  const shopSettings = useKeptResource<AdminShopSettings>(session.data?.role === "ADMIN" ? "/api/admin/settings" : null);
  const [signingOut, setSigningOut] = React.useState(false),
    [logoutError, setLogoutError] = React.useState<string | null>(null);
  const [changePasswordOpen, setChangePasswordOpen] = React.useState(false);
  const leaving = React.useRef(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [profileOpen, setProfileOpen] = React.useState(false);
  const profileRef = React.useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  React.useEffect(() => {
    if (!profileOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setProfileOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [profileOpen]);

  React.useEffect(() => {
    if (typeof document !== "undefined") {
      document.body.style.zoom = "";
      document.documentElement.style.zoom = "";
      document.documentElement.style.fontSize = "75%";
      try {
        localStorage.removeItem("zeus_admin_zoom");
      } catch {
        // ignore
      }
    }
    return () => {
      if (typeof document !== "undefined") {
        document.body.style.zoom = "";
        document.documentElement.style.zoom = "";
        document.documentElement.style.fontSize = "";
      }
    };
  }, []);
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
  const initials = staff.displayName
    .split(/\s+/)
    .map((n) => n[0])
    .slice(0, 2)
    .join("");
  const isMaintenance = Boolean(shopSettings.data?.maintenance);

  // P1-20: one screen tall. The sidebar (a drawer below md) and the header stay in place and
  // only #admin-content scrolls; nothing in the dashboard scrolls sideways.
  return (
    <LazyMotion features={domAnimation}>
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
          {NAV_ITEMS.filter((item) => !item.adminOnly || staff.role === "ADMIN").map(({ name, icon: Icon }, i) => {
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
                className={`relative flex w-full min-h-[44px] items-center gap-3 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary font-bold"
                    : "text-muted-foreground hover:bg-[#18181b] hover:text-foreground"
                }`}
              >
                {isActive && (
                  <m.span
                    layoutId="admin-sidebar-active"
                    aria-hidden="true"
                    transition={
                      reduceMotion
                        ? { duration: 0 }
                        : { type: "spring", stiffness: 420, damping: 34 }
                    }
                    className="pointer-events-none absolute inset-y-1.5 left-0 w-1 rounded-r-full bg-primary"
                  />
                )}
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{name}</span>
              </button>
            );
          })}
        </nav>

        {/* Staff footer */}
        <div className="mt-auto border-t border-border pt-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
                {initials}
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

          <button
            type="button"
            onClick={() => setChangePasswordOpen(true)}
            className="flex w-full items-center gap-2 rounded border border-border bg-[#141416] px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-[#1e1e22] transition-colors"
          >
            <KeyRound className="h-3.5 w-3.5 text-primary" />
            <span>Change password</span>
          </button>
        </div>
      </aside>

      {/* Main Admin Content */}
      <div inert={menuOpen} className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {isMaintenance && (
          <p role="status" className="shrink-0 border-b border-primary bg-primary/10 px-4 py-2 text-xs font-bold text-foreground sm:px-8 lg:px-10">{MAINTENANCE_BANNER}</p>
        )}
        <header className="shrink-0 border-b border-border bg-[#09090b]/95 px-4 py-3.5 backdrop-blur-xs sm:px-8 lg:px-10 lg:py-4">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">
                {new Intl.DateTimeFormat(brandConfig.locale, {
                  timeZone: brandConfig.timezone,
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                }).format(new Date())}
              </p>
              <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                {tab}
              </h1>
            </div>

            <div className="flex items-center gap-3">
              <span
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${
                  isMaintenance
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                    : "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    isMaintenance
                      ? "bg-amber-400"
                      : "bg-emerald-400 animate-pulse"
                  }`}
                />
                {isMaintenance ? "Maintenance Mode" : "Shop Live"}
              </span>

              <Link
                href="/book"
                className="group relative inline-flex min-h-[40px] items-center gap-2 overflow-hidden rounded-md bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-xs transition-all hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span>New Booking</span>
                <ArrowRight
                  className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </Link>

              <div ref={profileRef} className="relative">
                <button
                  type="button"
                  aria-label="Account menu"
                  aria-haspopup="menu"
                  aria-expanded={profileOpen}
                  onClick={() => setProfileOpen((v) => !v)}
                  className="inline-flex min-h-[40px] items-center gap-2 rounded-md border border-border bg-[#121214] px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-[#18181b] focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20 text-[11px] font-bold text-primary">
                    {initials}
                  </span>
                  <span className="hidden max-w-[8rem] truncate sm:inline">
                    {staff.displayName}
                  </span>
                  <ChevronDown
                    className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
                      profileOpen ? "rotate-180" : ""
                    }`}
                    aria-hidden="true"
                  />
                </button>

                {profileOpen && (
                  <div
                    role="menu"
                    aria-label="Account actions"
                    className="absolute right-0 top-full z-50 mt-2 w-56 rounded-lg border border-border bg-[#121214] p-1.5 shadow-xl"
                  >
                    <div className="border-b border-border/70 px-3 py-2">
                      <p className="truncate text-xs font-bold text-foreground">
                        {staff.displayName}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {staff.role === "ADMIN" ? "Shop Manager" : "Shop Staff"}
                      </p>
                    </div>
                    <div className="py-1">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setProfileOpen(false);
                          setTab("Settings");
                        }}
                        className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-[#18181b] hover:text-foreground"
                      >
                        <Settings className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                        <span>Shop settings</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setProfileOpen(false);
                          setChangePasswordOpen(true);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-[#18181b] hover:text-foreground"
                      >
                        <KeyRound className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                        <span>Change password</span>
                      </button>
                      <Link
                        href="/"
                        role="menuitem"
                        onClick={() => setProfileOpen(false)}
                        className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-[#18181b] hover:text-foreground"
                      >
                        <ExternalLink className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                        <span>Public shop site</span>
                      </Link>
                    </div>
                    <div className="border-t border-border/70 pt-1">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setProfileOpen(false);
                          void signOut();
                        }}
                        className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-xs text-rose-400 transition-colors hover:bg-rose-500/10"
                      >
                        <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Sign out</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        <main
          id="admin-content"
          tabIndex={-1}
          className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-6 focus:outline-none sm:px-8 lg:px-10 lg:py-8"
        >
          <div className="mx-auto max-w-[1600px]">
            {/* Active Tab View */}
            {tab === "Bookings" && (
              <BookingsTab role={staff.role} initialView={initialTab === "Bay Calendar" ? "CALENDAR" : "BOOKINGS"} />
            )}
            {tab === "Bay board" && <BayWorkspace role={staff.role} />}
            {tab === "Services" && <ServicesTab role={staff.role} />}
            {tab === "Team & Commissions" && <DetailersTab role={staff.role} />}
            {tab === "Supplies & Inventory" && <InventoryTab role={staff.role} />}
            {tab === "Expenses" && <ExpensesTab role={staff.role} />}
            {tab === "Sales Analytics" && <AnalyticsTab role={staff.role} />}
            {tab === "Users" && <UsersTab role={staff.role} currentUserId={staff.staffId} />}
            {tab === "Settings" && <SettingsTab role={staff.role} onChanged={shopSettings.reload} />}
          </div>
        </main>
      </div>

      <ChangePasswordDialog
        isOpen={changePasswordOpen}
        onClose={() => setChangePasswordOpen(false)}
      />
    </div>
    </LazyMotion>
  );
}
