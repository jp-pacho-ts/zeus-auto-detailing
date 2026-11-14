"use client";

import * as React from "react";
import Link from "next/link";
import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import {
  Banknote,
  BarChart3,
  Boxes,
  ChevronDown,
  ExternalLink,
  PanelLeftClose,
  PanelLeftOpen,
  Wallet,
  ClipboardList,
  Calendar,
  Columns3,
  LayoutDashboard,
  Users,
  User,
  UserCog,
  KeyRound,
  LogOut,
  Settings,
  Sparkles,
  Sun,
  Moon,
  Menu,
  X,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { DashboardTab } from "./dashboard-tab";
import { BookingsTab } from "./bookings-tab";
import { CalendarTab } from "./calendar-tab";
import { BayWorkspace } from "./bay-workspace";
import { ServicesTab } from "./services-tab";
import { DetailersTab } from "./detailers-tab";
import { PayrollTab } from "./payroll-tab";
import { InventoryTab } from "./inventory-tab";
import { ExpensesTab } from "./expenses-tab";
import { AnalyticsTab } from "./analytics-tab";
import { SettingsTab } from "./settings-tab";
import { UsersTab } from "./users-tab";
import { UserSettingsModal, applyAdminTheme } from "./user-settings-modal";
import { THEME_STORAGE_KEY, type AdminThemeMode, resolveEffectiveTheme } from "./user-settings/user-settings-model";
import { NotificationPopover } from "./notifications/notification-popover";
import { MAINTENANCE_BANNER } from "./settings/settings-model";
import { useKeptResource } from "./team/use-kept-resource";
import type { StaffSessionView } from "@/server/auth/types";
import type { AdminShopSettings } from "@/types/admin-contracts";
import { adminRequest } from "./bookings/client";
import { LoadState, useAdminResource } from "./bookings/use-admin-resource";
import { brandConfig } from "@/config/brand";

export type AdminTab =
  | "Dashboard"
  | "Bookings"
  | "Calendar"
  | "Bay Calendar"
  | "Bay board"
  | "Services"
  | "Staff"
  | "Payroll & Commissions"
  | "Team & Commissions"
  | "Supplies & Inventory"
  | "Expenses"
  | "Sales Analytics"
  | "Users"
  | "System Settings"
  | "Settings";

interface NavItem {
  name: AdminTab;
  group: "Operations" | "Management" | "Administration";
  icon: React.ComponentType<{
    className?: string;
    "aria-hidden"?: boolean | "true" | "false";
  }>;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { name: "Dashboard", group: "Operations", icon: LayoutDashboard },
  { name: "Bookings", group: "Operations", icon: ClipboardList },
  { name: "Calendar", group: "Operations", icon: Calendar },
  { name: "Bay board", group: "Operations", icon: Columns3 },
  { name: "Services", group: "Operations", icon: Sparkles },
  { name: "Staff", group: "Management", icon: Users },
  { name: "Payroll & Commissions", group: "Management", icon: Banknote },
  { name: "Supplies & Inventory", group: "Management", icon: Boxes },
  { name: "Expenses", group: "Management", icon: Wallet },
  { name: "Sales Analytics", group: "Management", icon: BarChart3 },
  { name: "Users", group: "Administration", icon: UserCog, adminOnly: true },
  { name: "System Settings", group: "Administration", icon: Settings, adminOnly: true },
];

const NAV_GROUPS: Array<{ key: NavItem["group"]; label: string }> = [
  { key: "Operations", label: "Operations" },
  { key: "Management", label: "Management" },
  { key: "Administration", label: "Administration" },
];

export function AdminPortal({ initialTab }: { initialTab?: AdminTab }) {
  const [bookingsView, setBookingsView] = React.useState<"BOOKINGS" | "CALENDAR">(
    initialTab === "Bay Calendar" ? "CALENDAR" : "BOOKINGS",
  );
  const [tab, setTab] = React.useState<AdminTab>(
    initialTab === "Bay Calendar"
      ? "Bookings"
      : initialTab === "Team & Commissions"
        ? "Staff"
        : initialTab === "Settings" || initialTab === "System Settings"
          ? "System Settings"
          : NAV_ITEMS.some((n) => n.name === initialTab)
            ? initialTab!
            : "Dashboard",
  );
  const session = useAdminResource<StaffSessionView>("/api/admin/auth/session");
  // The banner: a site left in maintenance must be impossible to miss on any admin screen.
  const shopSettings = useKeptResource<AdminShopSettings>(session.data?.role === "ADMIN" ? "/api/admin/settings" : null);
  const [signingOut, setSigningOut] = React.useState(false),
    [logoutError, setLogoutError] = React.useState<string | null>(null);
  const [userSettingsOpen, setUserSettingsOpen] = React.useState(false);
  const [userSettingsTab, setUserSettingsTab] = React.useState<"profile" | "security">("profile");

  const [currentTheme, setCurrentTheme] = React.useState<AdminThemeMode>(() => {
    if (typeof window === "undefined") return "dark";
    try {
      return (localStorage.getItem(THEME_STORAGE_KEY) as AdminThemeMode) || "dark";
    } catch {
      return "dark";
    }
  });

  const handleThemeChange = (next: AdminThemeMode) => {
    setCurrentTheme(next);
    applyAdminTheme(next);
  };

  const toggleTheme = () => {
    const systemPrefersDark = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const effective = resolveEffectiveTheme(currentTheme, systemPrefersDark);
    const next: AdminThemeMode = effective === "dark" ? "light" : "dark";
    handleThemeChange(next);
  };

  React.useEffect(() => {
    try {
      const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) as AdminThemeMode | null;
      if (savedTheme) {
        applyAdminTheme(savedTheme);
      }
    } catch {}

    return () => {
      // Revert to dark theme when leaving admin so public booking/storefront is never affected
      document.documentElement.classList.remove("light");
      document.documentElement.classList.add("dark");
    };
  }, []);
  const leaving = React.useRef(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(() => {
    try {
      return (
        typeof window !== "undefined" &&
        window.localStorage.getItem("zeus_admin_sidebar_collapsed") === "1"
      );
    } catch {
      return false;
    }
  });
  const [profileOpen, setProfileOpen] = React.useState(false);
  const profileRef = React.useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  const toggleSidebarCollapsed = React.useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("zeus_admin_sidebar_collapsed", next ? "1" : "0");
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }, []);

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
      document.documentElement.style.fontSize = "92.5%";
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
      document.body.style.height = "100%";
      document.documentElement.style.height = "100%";
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
        document.documentElement.style.overflow = "";
        document.body.style.overflow = "";
        document.body.style.height = "";
        document.documentElement.style.height = "";
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
      <main className="min-h-screen bg-background p-6 text-foreground">
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
    return session.loading ? (
      <LoadState
        loading={session.loading}
        error={session.error}
        retry={session.reload}
        variant="shell"
      />
    ) : (
      <main className="min-h-screen bg-background p-6 text-foreground">
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
  const isLight = resolveEffectiveTheme(currentTheme, typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) === "light";

  // only #admin-content scrolls; nothing in the dashboard scrolls sideways.
  return (
    <LazyMotion features={domAnimation}>
    <div className="admin-shell fixed inset-0 flex flex-col overflow-hidden bg-background text-[#f5f5f4] md:flex-row">
      <div inert={menuOpen} className="flex shrink-0 items-center justify-between border-b border-border bg-panel px-4 py-2 md:hidden">
        <Link href="/" aria-label="Return to public shop site">
          <Logo small mode={isLight ? "light" : "dark"} />
        </Link>
        <button
          ref={menuButton}
          type="button"
          aria-controls="admin-nav"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
          className="inline-flex min-h-[44px] items-center gap-2 rounded px-3 text-sm font-medium text-foreground hover:bg-card focus-visible:ring-2 focus-visible:ring-primary"
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
        className={`${menuOpen ? "flex" : "hidden"} fixed inset-y-0 left-0 z-40 w-72 max-w-[85vw] flex-col border-r border-border bg-panel transition-[width] duration-200 ease-out md:static md:z-auto md:flex md:max-w-none md:shrink-0 ${
          sidebarCollapsed ? "md:w-16" : "md:w-60"
        }`}
      >
        {/* Sidebar Header: Centered Logo & Flush 5rem (h-20) Height Aligned With Top Navbar */}
        <div className="relative flex h-20 shrink-0 items-center justify-between border-b border-border px-4 md:justify-center">
          <Link
            href="/"
            aria-label="Return to public shop site"
            className={`inline-flex items-center justify-center rounded-md focus-visible:ring-2 focus-visible:ring-primary ${
              sidebarCollapsed && !menuOpen ? "md:sr-only" : ""
            }`}
          >
            <Logo small mode={isLight ? "light" : "dark"} />
          </Link>

          {sidebarCollapsed && !menuOpen && (
            <button
              type="button"
              onClick={toggleSidebarCollapsed}
              aria-label="Expand sidebar"
              title="Expand sidebar"
              className="hidden h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-primary transition-colors hover:border-primary/40 hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-primary md:inline-flex"
            >
              <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
            </button>
          )}

          <button
            type="button"
            aria-label="Close menu"
            onClick={closeMenu}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-muted-foreground hover:bg-card hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary md:hidden"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Categorized Navigation (text-xs matching dashboard content) */}
        <nav
          aria-label="Shop Operations Navigation"
          className={`flex-1 space-y-6 px-3.5 py-5 ${
            sidebarCollapsed && !menuOpen
              ? "overflow-visible"
              : "overflow-y-auto"
          }`}
        >
          {(() => {
            const visibleItems = NAV_ITEMS.filter(
              (item) => !item.adminOnly || staff.role === "ADMIN",
            );
            const firstVisibleName = visibleItems[0]?.name;
            return NAV_GROUPS.map((group, groupIdx) => {
              const groupItems = visibleItems.filter(
                (item) => item.group === group.key,
              );
              if (groupItems.length === 0) return null;
              return (
                <div
                  key={group.key}
                  className={
                    groupIdx > 0
                      ? sidebarCollapsed && !menuOpen
                        ? "md:border-t md:border-border md:pt-4"
                        : "border-t border-border/60 pt-5"
                      : ""
                  }
                >
                  <p
                    className={`mb-2.5 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground ${
                      sidebarCollapsed && !menuOpen ? "md:sr-only" : ""
                    }`}
                  >
                    {group.label}
                  </p>
                  <div className="space-y-2">
                    {groupItems.map(({ name, icon: Icon }) => {
                      const isActive = tab === name;
                      const isFirst = name === firstVisibleName;
                      return (
                        <button
                          type="button"
                          key={name}
                          ref={isFirst ? firstNavItem : undefined}
                          aria-label={name === "System Settings" ? "Settings" : undefined}
                          onClick={() => {
                            if (name === "Bookings") setBookingsView("BOOKINGS");
                            setTab(name);
                            if (menuOpen) closeMenu();
                          }}
                          aria-current={isActive ? "page" : undefined}
                          className={`group relative flex w-full min-h-[44px] items-center gap-3 rounded-md px-3 py-2.5 text-xs transition-colors md:min-h-0 ${
                            sidebarCollapsed && !menuOpen
                              ? "md:justify-center md:px-0 md:py-2.5"
                              : ""
                          } ${
                            isActive
                              ? "font-bold text-primary"
                              : "font-medium text-muted-foreground hover:bg-card hover:text-foreground"
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
                              className="pointer-events-none absolute inset-0 rounded-md bg-primary/10 ring-1 ring-inset ring-primary/25"
                            />
                          )}
                          <Icon
                            className={`relative z-10 h-4 w-4 shrink-0 ${
                              isActive
                                ? "text-primary"
                                : "text-muted-foreground group-hover:text-foreground"
                            }`}
                            aria-hidden="true"
                          />
                          <span
                            className={
                              sidebarCollapsed && !menuOpen
                                ? "md:sr-only"
                                : "relative z-10 truncate"
                            }
                          >
                            <span>{name}</span>
                          </span>
                          {sidebarCollapsed && !menuOpen && (
                            <span
                              aria-hidden="true"
                              className="pointer-events-none absolute left-full top-1/2 z-50 ml-2.5 hidden -translate-y-1/2 whitespace-nowrap rounded border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 md:block"
                            >
                              {name}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            });
          })()}
        </nav>

        {/* Desktop Collapse / Expand Toggle Footer */}
        <div className="hidden border-t border-border p-2.5 md:block">
          <button
            type="button"
            onClick={toggleSidebarCollapsed}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-card hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary ${
              sidebarCollapsed ? "justify-center px-0" : ""
            }`}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            ) : (
              <>
                <PanelLeftClose className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">Collapse sidebar</span>
              </>
            )}
          </button>
        </div>
      </aside>

      {/* Main Admin Content */}
      <div inert={menuOpen} className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {isMaintenance && (
          <p role="status" className="shrink-0 border-b border-primary bg-primary/10 px-4 py-2 text-xs font-bold text-foreground sm:px-8 lg:px-10">{MAINTENANCE_BANNER}</p>
        )}
        <header className="flex shrink-0 items-center border-b border-border bg-panel px-4 py-3 sm:px-8 md:min-h-20 lg:px-10">
          <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center justify-between gap-4">
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
              <h1 className="mt-0.5 text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                {tab}
              </h1>
            </div>

            <div className="flex items-center gap-2.5">
              {/* Only alert if the customer storefront is in maintenance */}
              {isMaintenance && (
                <span
                  role="status"
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 text-xs font-semibold text-amber-400"
                >
                  <span className="h-2 w-2 rounded-full bg-amber-400" />
                  Maintenance Mode
                </span>
              )}

              {/* Public Storefront Preview Link */}
              <Link
                href="/"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Public Site"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-medium text-zinc-300 transition-colors hover:border-primary/40 hover:bg-zinc-800 hover:text-white focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span>Public Site</span>
                <ExternalLink className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
              </Link>

              {/* Real-time Notifications & Alerts */}
              <NotificationPopover onNavigate={(target) => setTab(target as AdminTab)} />

              {/* Quick Dark / Light Mode Toggle */}
              <button
                type="button"
                onClick={toggleTheme}
                aria-label={currentTheme === "dark" ? "Switch to light theme" : currentTheme === "light" ? "Switch to dark theme" : "Toggle theme (System active)"}
                title={currentTheme === "dark" ? "Switch to light theme" : currentTheme === "light" ? "Switch to dark theme" : "Theme: System (Click to toggle)"}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:border-primary/40 hover:bg-stone-50 dark:hover:bg-zinc-800 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
              >
                {resolveEffectiveTheme(currentTheme, typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) === "dark" ? (
                  <Sun className="h-4 w-4 text-amber-500 dark:text-amber-400" aria-hidden="true" />
                ) : (
                  <Moon className="h-4 w-4 text-primary" aria-hidden="true" />
                )}
              </button>

              <div ref={profileRef} className="relative">
                <button
                  type="button"
                  aria-label="Account menu"
                  aria-haspopup="menu"
                  aria-expanded={profileOpen}
                  onClick={() => setProfileOpen((v) => !v)}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
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
                    className="absolute right-0 top-full z-50 mt-2 w-52 rounded-lg border border-border bg-panel p-1.5 shadow-xl"
                  >
                    <div className="border-b border-border/70 px-3 py-2">
                      <p className="truncate text-xs font-bold text-foreground">
                        {staff.displayName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {staff.role === "ADMIN" ? "Shop Manager" : "Shop Staff"}
                      </p>
                    </div>
                    <div className="py-1">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setProfileOpen(false);
                          setTab("System Settings");
                        }}
                        className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
                      >
                        <Settings className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                        <span>System settings</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setProfileOpen(false);
                          setUserSettingsTab("profile");
                          setUserSettingsOpen(true);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
                      >
                        <User className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                        <span>Account & Preferences</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setProfileOpen(false);
                          setUserSettingsTab("security");
                          setUserSettingsOpen(true);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
                      >
                        <KeyRound className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                        <span>Change password</span>
                      </button>
                      <Link
                        href="/"
                        role="menuitem"
                        onClick={() => setProfileOpen(false)}
                        className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
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
            {tab === "Dashboard" && (
              <DashboardTab
                role={staff.role}
                onNavigate={(next) => {
                  if (next === "Bay Calendar" || next === "Calendar") {
                    setTab("Calendar");
                  } else {
                    setBookingsView("BOOKINGS");
                    setTab(next);
                  }
                }}
              />
            )}
            {tab === "Bookings" && (
              <BookingsTab
                key={bookingsView}
                role={staff.role}
                initialView={bookingsView}
                onNavigateCalendar={() => setTab("Calendar")}
              />
            )}
            {(tab === "Calendar" || (tab === "Bay Calendar" && bookingsView !== "CALENDAR")) && (
              <CalendarTab role={staff.role} />
            )}
            {tab === "Bay board" && <BayWorkspace role={staff.role} />}
            {tab === "Services" && <ServicesTab role={staff.role} />}
            {(tab === "Staff" || tab === "Team & Commissions") && <DetailersTab role={staff.role} />}
            {tab === "Payroll & Commissions" && <PayrollTab role={staff.role} />}
            {tab === "Supplies & Inventory" && <InventoryTab role={staff.role} />}
            {tab === "Expenses" && <ExpensesTab role={staff.role} />}
            {tab === "Sales Analytics" && <AnalyticsTab role={staff.role} />}
            {tab === "Users" && <UsersTab role={staff.role} currentUserId={staff.staffId} />}
            {(tab === "System Settings" || tab === "Settings") && <SettingsTab role={staff.role} onChanged={shopSettings.reload} />}
          </div>
        </main>
      </div>

      <UserSettingsModal
        isOpen={userSettingsOpen}
        onClose={() => setUserSettingsOpen(false)}
        staff={staff}
        initialTab={userSettingsTab}
        currentTheme={currentTheme}
        onThemeChange={handleThemeChange}
      />
    </div>
    </LazyMotion>
  );
}
