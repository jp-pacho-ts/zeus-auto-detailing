"use client";

import * as React from "react";
import {
  X,
  User,
  Palette,
  ShieldCheck,
  Volume2,
  VolumeX,
  KeyRound,
  Sun,
  Moon,
  Monitor,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Clock,
  Check,
} from "lucide-react";
import type { StaffSessionView } from "@/server/auth/types";
import { adminRequest, AdminRequestError } from "./bookings/client";
import {
  type AdminThemeMode,
  THEME_STORAGE_KEY,
  AUDIO_NOTIFICATION_KEY,
  THEME_OPTIONS,
  validatePasswordInput,
  formatTimeRemaining,
  resolveEffectiveTheme,
} from "./user-settings/user-settings-model";

interface UserSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  staff: StaffSessionView;
  initialTab?: "profile" | "appearance" | "security";
}

/**
 * Apply the selected theme mode to documentElement and persist to localStorage.
 */
export function applyAdminTheme(mode: AdminThemeMode) {
  if (typeof window === "undefined") return;
  const root = document.documentElement;
  const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const effective = resolveEffectiveTheme(mode, systemPrefersDark);

  if (effective === "dark") {
    root.classList.add("dark");
    root.classList.remove("light");
  } else {
    root.classList.add("light");
    root.classList.remove("dark");
  }

  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {}
}

/**
 * Plays a short, pleasant zero-file audio chime using Web Audio API.
 */
export function playNotificationChime() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5

    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch {}
}

export function UserSettingsModal({
  isOpen,
  onClose,
  staff,
  initialTab = "profile",
}: UserSettingsModalProps) {
  const [selectedTab, setSelectedTab] = React.useState<"profile" | "appearance" | "security" | null>(null);
  const activeTab = selectedTab ?? initialTab;

  const handleClose = () => {
    setSelectedTab(null);
    onClose();
  };

  // Theme state
  const [themeMode, setThemeMode] = React.useState<AdminThemeMode>(() => {
    if (typeof window === "undefined") return "dark";
    try {
      return (localStorage.getItem(THEME_STORAGE_KEY) as AdminThemeMode) || "dark";
    } catch {
      return "dark";
    }
  });

  // Sound notification preference
  const [soundEnabled, setSoundEnabled] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      const stored = localStorage.getItem(AUDIO_NOTIFICATION_KEY);
      return stored === null ? true : stored === "true";
    } catch {
      return true;
    }
  });

  // Password state
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [savingPassword, setSavingPassword] = React.useState(false);
  const [passwordError, setPasswordError] = React.useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = React.useState(false);

  const handleThemeChange = (mode: AdminThemeMode) => {
    setThemeMode(mode);
    applyAdminTheme(mode);
  };

  const handleSoundToggle = (enabled: boolean) => {
    setSoundEnabled(enabled);
    try {
      localStorage.setItem(AUDIO_NOTIFICATION_KEY, String(enabled));
    } catch {}
    if (enabled) {
      playNotificationChime();
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);

    const validation = validatePasswordInput(currentPassword, newPassword, confirmPassword);
    if (!validation.valid) {
      setPasswordError(validation.error || "Please check your password inputs.");
      return;
    }

    setSavingPassword(true);
    try {
      await adminRequest<{ ok: true }>("/api/admin/auth/change-password", {
        method: "POST",
        body: { currentPassword, newPassword },
      });
      setPasswordSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => {
        setPasswordSuccess(false);
      }, 4000);
    } catch (err) {
      if (err instanceof AdminRequestError) {
        setPasswordError(err.message);
      } else {
        setPasswordError("Unable to change password. Check your connection and try again.");
      }
    } finally {
      setSavingPassword(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="user-settings-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
    >
      <div className="relative flex w-full max-w-2xl flex-col rounded-2xl border border-border bg-[#121214] shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4 bg-[#18181b]/50">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 border border-primary/20 text-primary">
              <User className="h-5 w-5" />
            </div>
            <div>
              <h2 id="user-settings-title" className="text-base font-bold text-foreground">
                Account & Preferences
              </h2>
              <p className="text-xs text-muted-foreground">
                Manage your profile, theme appearance, and security credentials.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-white/5 hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-border bg-[#0e0e10] px-6">
          <button
            type="button"
            onClick={() => setSelectedTab("profile")}
            className={`flex min-h-[44px] items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-semibold transition-colors ${
              activeTab === "profile"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <User className="h-3.5 w-3.5" />
            <span>Profile & Session</span>
          </button>
          <button
            type="button"
            onClick={() => setSelectedTab("appearance")}
            className={`flex min-h-[44px] items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-semibold transition-colors ${
              activeTab === "appearance"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Palette className="h-3.5 w-3.5" />
            <span>Appearance & Theme</span>
          </button>
          <button
            type="button"
            onClick={() => setSelectedTab("security")}
            className={`flex min-h-[44px] items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-semibold transition-colors ${
              activeTab === "security"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Security</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 max-h-[70vh] overflow-y-auto">
          {/* TAB 1: Profile & Session */}
          {activeTab === "profile" && (
            <div className="space-y-6">
              {/* User Identity Card */}
              <div className="flex items-center gap-4 rounded-xl border border-border bg-[#18181b] p-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary/20 text-primary font-bold text-lg border border-primary/30">
                  {staff.displayName
                    .split(" ")
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-bold text-foreground">
                      {staff.displayName}
                    </p>
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                      {staff.role === "ADMIN" ? "Shop Manager" : "Shop Staff"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground font-mono">
                    ID: {staff.staffId.slice(0, 8)}...
                  </p>
                </div>
              </div>

              {/* Session Information */}
              <div className="rounded-xl border border-border bg-[#18181b] p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-foreground uppercase tracking-wider">
                  <Clock className="h-3.5 w-3.5 text-primary" />
                  <span>Session Lifetime</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="rounded-lg bg-[#121214] p-3 border border-border/60">
                    <p className="text-[11px] text-muted-foreground">Idle Expiration</p>
                    <p className="mt-1 font-semibold text-foreground">
                      {formatTimeRemaining(staff.idleExpiresAt)} of inactivity
                    </p>
                  </div>
                  <div className="rounded-lg bg-[#121214] p-3 border border-border/60">
                    <p className="text-[11px] text-muted-foreground">Absolute Session Expiration</p>
                    <p className="mt-1 font-semibold text-foreground">
                      {formatTimeRemaining(staff.expiresAt)} remaining
                    </p>
                  </div>
                </div>
              </div>

              {/* Sound & Notifications Preference */}
              <div className="rounded-xl border border-border bg-[#18181b] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {soundEnabled ? (
                      <Volume2 className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <VolumeX className="h-4 w-4 text-muted-foreground" />
                    )}
                    <div>
                      <p className="text-xs font-bold text-foreground">Audio Alerts for New Bookings</p>
                      <p className="text-[11px] text-muted-foreground">
                        Play an audio chime when an online appointment is requested.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleSoundToggle(!soundEnabled)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
                        soundEnabled ? "bg-primary" : "bg-zinc-700"
                      }`}
                      aria-label="Toggle audio alerts"
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          soundEnabled ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                    {soundEnabled && (
                      <button
                        type="button"
                        onClick={playNotificationChime}
                        className="min-h-[44px] rounded-lg px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-primary/10 transition-colors"
                      >
                        Test chime
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Appearance & Theme */}
          {activeTab === "appearance" && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-foreground">Dashboard Appearance</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Select your preferred interface contrast. Preference is remembered on this device.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                {THEME_OPTIONS.map((opt) => {
                  const isSelected = themeMode === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => handleThemeChange(opt.id)}
                      className={`flex flex-col justify-between rounded-xl border p-4 text-left transition-all ${
                        isSelected
                          ? "border-primary bg-primary/10 ring-1 ring-primary"
                          : "border-border bg-[#18181b] hover:border-border/80 hover:bg-[#1a1a1e]"
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#121214] border border-border">
                            {opt.id === "dark" && <Moon className="h-4 w-4 text-amber-400" />}
                            {opt.id === "light" && <Sun className="h-4 w-4 text-amber-500" />}
                            {opt.id === "system" && <Monitor className="h-4 w-4 text-primary" />}
                          </div>
                          {isSelected && (
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-black">
                              <Check className="h-3 w-3 stroke-[3]" />
                            </span>
                          )}
                        </div>
                        <p className="mt-3 text-xs font-bold text-foreground">{opt.title}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
                          {opt.description}
                        </p>
                      </div>
                      {opt.badge && (
                        <div className="mt-3">
                          <span className="inline-block rounded bg-primary/20 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                            {opt.badge}
                          </span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Live Preview Card */}
              <div className="mt-6 rounded-xl border border-border bg-[#18181b] p-4">
                <p className="text-xs font-bold text-foreground">Theme Palette Preview</p>
                {themeMode === "light" ? (
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                    <div className="rounded-lg bg-[#f8f9fa] p-2.5 border border-zinc-200 text-center shadow-xs">
                      <span className="block text-zinc-800 font-mono font-bold">#f8f9fa</span>
                      <span className="text-[10px] text-zinc-500">Daylight Canvas</span>
                    </div>
                    <div className="rounded-lg bg-[#ffffff] p-2.5 border border-zinc-200 text-center shadow-xs">
                      <span className="block text-zinc-900 font-mono font-bold">#ffffff</span>
                      <span className="text-[10px] text-zinc-500">Elevated Card</span>
                    </div>
                    <div className="rounded-lg bg-[#c08818] p-2.5 text-center text-black font-bold">
                      <span className="block font-mono">#c08818</span>
                      <span className="text-[10px] opacity-90">Zeus Gold</span>
                    </div>
                    <div className="rounded-lg bg-[#0f172a] p-2.5 text-center text-white font-bold">
                      <span className="block font-mono">#0f172a</span>
                      <span className="text-[10px] opacity-90">Deep Ink Text</span>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                    <div className="rounded-lg bg-[#09090b] p-2.5 border border-zinc-800 text-center">
                      <span className="block text-zinc-400 font-mono">#09090b</span>
                      <span className="text-[10px] text-zinc-500">Obsidian Canvas</span>
                    </div>
                    <div className="rounded-lg bg-[#18181b] p-2.5 border border-zinc-800 text-center">
                      <span className="block text-zinc-300 font-mono">#18181b</span>
                      <span className="text-[10px] text-zinc-500">Surface Card</span>
                    </div>
                    <div className="rounded-lg bg-[#c08818] p-2.5 text-center text-black font-bold">
                      <span className="block font-mono">#c08818</span>
                      <span className="text-[10px] opacity-80">Zeus Gold</span>
                    </div>
                    <div className="rounded-lg bg-[#10b981] p-2.5 text-center text-black font-bold">
                      <span className="block font-mono">#10b981</span>
                      <span className="text-[10px] opacity-80">Emerald Status</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: Security & Credentials */}
          {activeTab === "security" && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-foreground">Update Password</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Passwords must be at least 15 characters long. Changing your password keeps your current session active.
                </p>
              </div>

              {passwordSuccess ? (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-6 text-center">
                  <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" />
                  <p className="mt-2 text-sm font-bold text-foreground">Password Changed Successfully</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Your credentials have been updated securely.
                  </p>
                </div>
              ) : (
                <form onSubmit={handlePasswordSubmit} className="space-y-4">
                  {passwordError && (
                    <div className="flex items-start gap-2 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-400">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>{passwordError}</span>
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="modal-current-password"
                      className="block text-xs font-semibold text-muted-foreground"
                    >
                      Current Password
                    </label>
                    <input
                      id="modal-current-password"
                      type="password"
                      autoComplete="current-password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-border bg-[#18181b] px-3.5 py-2.5 text-xs text-foreground focus:border-primary focus:outline-none"
                      placeholder="Enter current password"
                      required
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="modal-new-password"
                      className="block text-xs font-semibold text-muted-foreground"
                    >
                      New Password
                    </label>
                    <input
                      id="modal-new-password"
                      type="password"
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-border bg-[#18181b] px-3.5 py-2.5 text-xs text-foreground focus:border-primary focus:outline-none"
                      placeholder="Minimum 15 characters"
                      required
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Use a long passphrase (15+ chars) for strong protection.
                    </p>
                  </div>

                  <div>
                    <label
                      htmlFor="modal-confirm-password"
                      className="block text-xs font-semibold text-muted-foreground"
                    >
                      Confirm New Password
                    </label>
                    <input
                      id="modal-confirm-password"
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="mt-1.5 w-full rounded-lg border border-border bg-[#18181b] px-3.5 py-2.5 text-xs text-foreground focus:border-primary focus:outline-none"
                      placeholder="Re-enter new password"
                      required
                    />
                  </div>

                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={savingPassword}
                      className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-xs font-bold text-black transition-colors hover:bg-primary-hover disabled:opacity-50"
                    >
                      {savingPassword ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>Saving new password...</span>
                        </>
                      ) : (
                        <>
                          <KeyRound className="h-4 w-4" />
                          <span>Update Password</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end border-t border-border px-6 py-3.5 bg-[#18181b]/50">
          <button
            type="button"
            onClick={handleClose}
            className="min-h-[44px] rounded-lg border border-border bg-[#121214] px-4 py-2 text-xs font-semibold text-foreground hover:bg-[#18181b] transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
