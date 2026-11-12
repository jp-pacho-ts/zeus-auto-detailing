"use client";

import * as React from "react";
import { KeyRound, X, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { adminRequest, AdminRequestError } from "./bookings/client";

interface ChangePasswordDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ChangePasswordDialog({ isOpen, onClose }: ChangePasswordDialogProps) {
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [success, setSuccess] = React.useState(false);

  const resetForm = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError(null);
    setFieldErrors({});
    setSuccess(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    if (!currentPassword) {
      setFieldErrors({ currentPassword: ["Enter your current password."] });
      return;
    }
    if (newPassword.length < 15) {
      setFieldErrors({ newPassword: ["Password must be at least 15 characters long."] });
      return;
    }
    if (newPassword !== confirmPassword) {
      setFieldErrors({ confirmPassword: ["New passwords do not match."] });
      return;
    }

    setSaving(true);
    try {
      await adminRequest<{ ok: true }>("/api/admin/auth/change-password", {
        method: "POST",
        body: { currentPassword, newPassword },
      });
      setSuccess(true);
      setTimeout(() => {
        handleClose();
      }, 1500);
    } catch (err) {
      if (err instanceof AdminRequestError) {
        setError(err.message);
        setFieldErrors(err.fieldErrors);
      } else {
        setError("Unable to change password. Please check your connection and try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="change-password-title"
      className="fixed inset-0 z-50 overflow-y-auto bg-black/75 p-4 sm:p-6 grid place-items-center"
    >
      <div className="relative my-auto w-full max-w-md max-h-[calc(100vh-3rem)] rounded-xl border border-border bg-card p-6 shadow-2xl overflow-y-auto">
        <div className="flex items-center justify-between pb-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <KeyRound className="h-4 w-4" />
            </div>
            <h2 id="change-password-title" className="text-base font-bold text-foreground">
              Change Password
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded p-1 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {success ? (
          <div className="py-8 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-400" />
            <p className="mt-3 text-sm font-semibold text-foreground">Password Changed Successfully</p>
            <p className="mt-1 text-xs text-muted-foreground">Your session remains active.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            {error && (
              <div className="flex items-start gap-2 rounded-lg bg-rose-500/10 border border-rose-500/20 p-3 text-xs text-rose-400">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label htmlFor="current-password" className="block text-xs font-semibold text-muted-foreground">
                Current Password
              </label>
              <input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="mt-1 w-full rounded border border-border bg-panel px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                required
              />
              {fieldErrors.currentPassword && (
                <p className="mt-1 text-xs text-rose-400">{fieldErrors.currentPassword[0]}</p>
              )}
            </div>

            <div>
              <label htmlFor="new-password" className="block text-xs font-semibold text-muted-foreground">
                New Password
              </label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="mt-1 w-full rounded border border-border bg-panel px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                required
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Must be at least 15 characters and not easy to guess.
              </p>
              {fieldErrors.newPassword && (
                <p className="mt-1 text-xs text-rose-400">{fieldErrors.newPassword[0]}</p>
              )}
            </div>

            <div>
              <label htmlFor="confirm-password" className="block text-xs font-semibold text-muted-foreground">
                Confirm New Password
              </label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1 w-full rounded border border-border bg-panel px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                required
              />
              {fieldErrors.confirmPassword && (
                <p className="mt-1 text-xs text-rose-400">{fieldErrors.confirmPassword[0]}</p>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-3 pt-4 border-t border-border">
              <button
                type="button"
                onClick={handleClose}
                disabled={saving}
                className="rounded px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Update Password
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
