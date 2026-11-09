"use client";

import * as React from "react";
import {
  UserPlus,
  KeyRound,
  Edit2,
  Copy,
  Check,
  AlertTriangle,
  Loader2,
  Shield,
  UserCheck,
  UserX,
  X,
  RefreshCw,
} from "lucide-react";
import type { AdminUser, AdminUserCreateResult, AdminUserResetPasswordResult } from "@/types/admin-contracts";
import type { UserRole } from "@/types/contracts";
import { adminRequest, AdminRequestError } from "./bookings/client";
import { useAdminResource } from "./bookings/use-admin-resource";

interface UsersTabProps {
  role: UserRole;
  currentUserId?: string;
}

export function UsersTab({ role, currentUserId }: UsersTabProps) {
  const resource = useAdminResource<AdminUser[]>("/api/admin/users");
  const users = resource.data ?? [];

  const [createOpen, setCreateOpen] = React.useState(false);
  const [editUser, setEditUser] = React.useState<AdminUser | null>(null);
  const [resetTarget, setResetTarget] = React.useState<AdminUser | null>(null);
  const [tempPasswordModal, setTempPasswordModal] = React.useState<{
    name: string;
    email: string;
    password: string;
  } | null>(null);

  // Create form state
  const [createName, setCreateName] = React.useState("");
  const [createEmail, setCreateEmail] = React.useState("");
  const [createPhone, setCreatePhone] = React.useState("");
  const [createRole, setCreateRole] = React.useState<"SUPERADMIN" | "ADMIN">("ADMIN");
  const [createSaving, setCreateSaving] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);
  const [createFieldErrors, setCreateFieldErrors] = React.useState<Record<string, string[]>>({});

  // Edit form state
  const [editName, setEditName] = React.useState("");
  const [editPhone, setEditPhone] = React.useState("");
  const [editRole, setEditRole] = React.useState<"SUPERADMIN" | "ADMIN">("ADMIN");
  const [editActive, setEditActive] = React.useState(true);
  const [editSaving, setEditSaving] = React.useState(false);
  const [editError, setEditError] = React.useState<string | null>(null);
  const [editFieldErrors, setEditFieldErrors] = React.useState<Record<string, string[]>>({});

  // Reset password state
  const [resetSaving, setResetSaving] = React.useState(false);
  const [resetError, setResetError] = React.useState<string | null>(null);

  // Copy state for temp password
  const [copied, setCopied] = React.useState(false);

  const openEdit = (u: AdminUser) => {
    setEditUser(u);
    setEditName(u.name);
    setEditPhone(u.phone);
    setEditRole(u.role);
    setEditActive(u.isActive);
    setEditError(null);
    setEditFieldErrors({});
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateSaving(true);
    setCreateError(null);
    setCreateFieldErrors({});

    try {
      const res = await adminRequest<AdminUserCreateResult>("/api/admin/users", {
        method: "POST",
        body: {
          name: createName,
          email: createEmail,
          phone: createPhone,
          role: createRole,
        },
      });
      setCreateOpen(false);
      setCreateName("");
      setCreateEmail("");
      setCreatePhone("");
      setCreateRole("ADMIN");
      resource.reload();
      setTempPasswordModal({
        name: res.user.name,
        email: res.user.email,
        password: res.temporaryPassword,
      });
    } catch (err) {
      if (err instanceof AdminRequestError) {
        setCreateError(err.message);
        setCreateFieldErrors(err.fieldErrors);
      } else {
        setCreateError("Failed to create account. Please check inputs and retry.");
      }
    } finally {
      setCreateSaving(false);
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUser) return;
    setEditSaving(true);
    setEditError(null);
    setEditFieldErrors({});

    try {
      await adminRequest<AdminUser>(`/api/admin/users/${editUser.id}`, {
        method: "PATCH",
        body: {
          expectedRevision: editUser.revision,
          name: editName,
          phone: editPhone,
          role: editRole,
          isActive: editActive,
        },
      });
      setEditUser(null);
      resource.reload();
    } catch (err) {
      if (err instanceof AdminRequestError) {
        setEditError(err.message);
        setEditFieldErrors(err.fieldErrors);
      } else {
        setEditError("Failed to update account. Please retry.");
      }
    } finally {
      setEditSaving(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetTarget) return;
    setResetSaving(true);
    setResetError(null);

    try {
      const res = await adminRequest<AdminUserResetPasswordResult>(
        `/api/admin/users/${resetTarget.id}/reset-password`,
        { method: "POST", body: {} },
      );
      const target = resetTarget;
      setResetTarget(null);
      resource.reload();
      setTempPasswordModal({
        name: target.name,
        email: target.email,
        password: res.temporaryPassword,
      });
    } catch (err) {
      if (err instanceof AdminRequestError) {
        setResetError(err.message);
      } else {
        setResetError("Failed to reset password. Please retry.");
      }
    } finally {
      setResetSaving(false);
    }
  };

  const copyPassword = () => {
    if (!tempPasswordModal) return;
    navigator.clipboard.writeText(tempPasswordModal.password);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (role !== "ADMIN") {
    return (
      <div className="rounded-xl border border-border bg-[#18181b] p-8 text-center text-muted-foreground">
        <Shield className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
        <p className="text-sm font-semibold">Administrator Access Required</p>
        <p className="mt-1 text-xs">Only shop administrators can manage staff accounts.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Header / Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-foreground">User Management</h2>
          <p className="text-xs text-muted-foreground">
            Manage staff accounts, assign roles, and handle password resets.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => resource.reload()}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded border border-border bg-[#18181b] px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${resource.loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => {
              setCreateError(null);
              setCreateFieldErrors({});
              setCreateOpen(true);
            }}
            className="inline-flex min-h-[36px] items-center gap-1.5 rounded bg-primary px-3.5 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary-hover shadow-sm"
          >
            <UserPlus className="h-3.5 w-3.5" />
            Add Account
          </button>
        </div>
      </div>

      {/* Users List */}
      <div className="overflow-hidden rounded-xl border border-border bg-[#18181b]">
        {resource.loading && users.length === 0 ? (
          <div className="flex items-center justify-center p-12 text-xs text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2 text-primary" /> Loading user accounts...
          </div>
        ) : resource.error ? (
          <div className="p-8 text-center text-xs text-rose-400">
            Failed to load users: {resource.error}. Please refresh the page.
          </div>
        ) : users.length === 0 ? (
          <div className="p-12 text-center text-xs text-muted-foreground">
            No staff accounts found. Click &quot;Add Account&quot; to create one.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {users.map((u) => {
              const isCurrent = currentUserId === u.id;
              return (
                <li
                  key={u.id}
                  className="flex flex-col gap-3 p-4 transition-colors sm:flex-row sm:items-center sm:justify-between sm:px-6 hover:bg-[#1e1e22]/50"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full border border-border bg-[#27272a] text-xs font-bold text-primary">
                      {u.name
                        .trim()
                        .split(/\s+/)
                        .map((part) => part[0])
                        .slice(0, 2)
                        .join("")
                        .toUpperCase() || "??"}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-foreground text-sm">{u.name}</span>
                        {isCurrent && (
                          <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                            You
                          </span>
                        )}
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                            u.role === "SUPERADMIN"
                              ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                              : "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                          }`}
                        >
                          {u.role === "SUPERADMIN" ? "Super Admin" : "Admin"}
                        </span>
                        {u.isActive ? (
                          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
                            <UserCheck className="h-3 w-3" /> Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] text-rose-400 font-medium">
                            <UserX className="h-3 w-3" /> Inactive
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                        <span>{u.email}</span>
                        {u.phone && <span>· {u.phone}</span>}
                        <span>
                          · {u.hasCredential ? "Password set" : "No password"}
                          {u.passwordChangedAt && ` (${new Date(u.passwordChangedAt).toLocaleDateString()})`}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEdit(u)}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded border border-border bg-[#141416] px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
                    >
                      <Edit2 className="h-3.5 w-3.5" /> Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setResetTarget(u);
                        setResetError(null);
                      }}
                      className="inline-flex min-h-[36px] items-center gap-1.5 rounded border border-border bg-[#141416] px-3 py-1.5 text-xs font-semibold text-amber-400 hover:text-amber-300 hover:border-amber-500/30"
                    >
                      <KeyRound className="h-3.5 w-3.5" /> Reset Password
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Add Account Modal */}
      {createOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-account-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        >
          <div className="relative w-full max-w-md rounded-xl border border-border bg-[#18181b] p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-border">
              <h3 id="create-account-title" className="text-base font-bold text-foreground">
                Add Staff Account
              </h3>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="mt-4 space-y-4">
              {createError && (
                <div className="flex items-start gap-2 rounded-lg bg-rose-500/10 border border-rose-500/20 p-3 text-xs text-rose-400">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{createError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-muted-foreground">Full Name</label>
                <input
                  type="text"
                  required
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="e.g. Maria Santos"
                  className="mt-1 w-full rounded border border-border bg-[#121214] px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                />
                {createFieldErrors.name && (
                  <p className="mt-1 text-[11px] text-rose-400">{createFieldErrors.name[0]}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground">Email Address</label>
                <input
                  type="email"
                  required
                  value={createEmail}
                  onChange={(e) => setCreateEmail(e.target.value)}
                  placeholder="e.g. maria@zeusautodetailing.test"
                  className="mt-1 w-full rounded border border-border bg-[#121214] px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                />
                {createFieldErrors.email && (
                  <p className="mt-1 text-[11px] text-rose-400">{createFieldErrors.email[0]}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground">Phone Number</label>
                <input
                  type="text"
                  value={createPhone}
                  onChange={(e) => setCreatePhone(e.target.value)}
                  placeholder="e.g. +63 917 555 1234"
                  className="mt-1 w-full rounded border border-border bg-[#121214] px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                />
                {createFieldErrors.phone && (
                  <p className="mt-1 text-[11px] text-rose-400">{createFieldErrors.phone[0]}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground">Account Role</label>
                <select
                  value={createRole}
                  onChange={(e) => setCreateRole(e.target.value as "SUPERADMIN" | "ADMIN")}
                  className="mt-1 w-full rounded border border-border bg-[#121214] px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                >
                  <option value="ADMIN">Admin (Full shop manager)</option>
                  <option value="SUPERADMIN">Super Admin (System Owner)</option>
                </select>
              </div>

              <p className="text-[11px] text-muted-foreground bg-[#141416] p-3 rounded border border-border">
                A cryptographically secure temporary password will be generated upon creation and displayed once for you to provide to the user.
              </p>

              <div className="mt-6 flex justify-end gap-3 pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  disabled={createSaving}
                  className="rounded px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createSaving}
                  className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
                >
                  {createSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Create Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Account Modal */}
      {editUser && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-account-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        >
          <div className="relative w-full max-w-md rounded-xl border border-border bg-[#18181b] p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-border">
              <h3 id="edit-account-title" className="text-base font-bold text-foreground">
                Edit Staff Account
              </h3>
              <button
                type="button"
                onClick={() => setEditUser(null)}
                className="rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleEdit} className="mt-4 space-y-4">
              {editError && (
                <div className="flex items-start gap-2 rounded-lg bg-rose-500/10 border border-rose-500/20 p-3 text-xs text-rose-400">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{editError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-muted-foreground">Email</label>
                <input
                  type="text"
                  disabled
                  value={editUser.email}
                  className="mt-1 w-full rounded border border-border bg-[#121214] px-3 py-2 text-xs text-muted-foreground opacity-70 cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground">Full Name</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="mt-1 w-full rounded border border-border bg-[#121214] px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                />
                {editFieldErrors.name && (
                  <p className="mt-1 text-[11px] text-rose-400">{editFieldErrors.name[0]}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground">Phone Number</label>
                <input
                  type="text"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="mt-1 w-full rounded border border-border bg-[#121214] px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                />
                {editFieldErrors.phone && (
                  <p className="mt-1 text-[11px] text-rose-400">{editFieldErrors.phone[0]}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground">Account Role</label>
                {editUser.role === "SUPERADMIN" ? (
                  <div className="mt-1 flex items-center gap-2 rounded border border-border bg-[#141416] px-3 py-2 text-xs text-amber-400 font-bold">
                    Super Admin (Primary Owner Account)
                  </div>
                ) : (
                  <select
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value as "SUPERADMIN" | "ADMIN")}
                    className="mt-1 w-full rounded border border-border bg-[#121214] px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                  >
                    <option value="ADMIN">Admin (Full shop manager)</option>
                    <option value="SUPERADMIN">Super Admin (System Owner)</option>
                  </select>
                )}
              </div>

              <div className="flex items-center justify-between rounded bg-[#141416] p-3 border border-border">
                <div>
                  <p className="text-xs font-semibold text-foreground">Account Status</p>
                  <p className="text-[11px] text-muted-foreground">
                    Inactive accounts cannot sign in.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editActive}
                    disabled={currentUserId === editUser.id || editUser.role === "SUPERADMIN"}
                    onChange={(e) => setEditActive(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                </label>
              </div>
              {editUser.role === "SUPERADMIN" ? (
                <p className="text-[11px] text-amber-400/90">
                  Super Admin accounts cannot be deactivated.
                </p>
              ) : currentUserId === editUser.id ? (
                <p className="text-[11px] text-muted-foreground">
                  You cannot deactivate your own signed-in administrator account.
                </p>
              ) : null}

              <div className="mt-6 flex justify-end gap-3 pt-4 border-t border-border">
                <button
                  type="button"
                  onClick={() => setEditUser(null)}
                  disabled={editSaving}
                  className="rounded px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editSaving}
                  className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
                >
                  {editSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Confirmation Modal */}
      {resetTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-password-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        >
          <div className="relative w-full max-w-md rounded-xl border border-border bg-[#18181b] p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-border">
              <h3 id="reset-password-title" className="text-base font-bold text-foreground">
                Reset Password
              </h3>
              <button
                type="button"
                onClick={() => setResetTarget(null)}
                className="rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {resetError && (
                <div className="flex items-start gap-2 rounded-lg bg-rose-500/10 border border-rose-500/20 p-3 text-xs text-rose-400">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{resetError}</span>
                </div>
              )}

              <p className="text-xs text-foreground">
                Are you sure you want to reset the password for{" "}
                <span className="font-bold text-primary">{resetTarget.name}</span> ({resetTarget.email})?
              </p>
              <p className="text-[11px] text-muted-foreground">
                A new temporary password will be generated, and all existing active sessions for this user will be revoked immediately.
              </p>
            </div>

            <div className="mt-6 flex justify-end gap-3 pt-4 border-t border-border">
              <button
                type="button"
                onClick={() => setResetTarget(null)}
                disabled={resetSaving}
                className="rounded px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleResetPassword}
                disabled={resetSaving}
                className="inline-flex items-center gap-2 rounded bg-amber-500 px-4 py-2 text-xs font-bold text-black hover:bg-amber-400 disabled:opacity-50"
              >
                {resetSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Reset & Generate Password
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Temporary Password Reveal Modal */}
      {tempPasswordModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="temp-password-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
        >
          <div className="relative w-full max-w-md rounded-xl border border-amber-500/40 bg-[#18181b] p-6 shadow-2xl">
            <div className="flex items-center gap-2 pb-4 border-b border-border text-amber-400">
              <KeyRound className="h-5 w-5" />
              <h3 id="temp-password-title" className="text-base font-bold text-foreground">
                Temporary Password Generated
              </h3>
            </div>

            <div className="mt-4 space-y-4">
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-300">
                <p className="font-semibold">Important:</p>
                <p className="mt-1">
                  This temporary password will <span className="underline font-bold">only be displayed once</span>.
                  Copy and share it securely with <span className="font-bold">{tempPasswordModal.name}</span>.
                </p>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Temporary Password
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <div className="flex-1 rounded border border-border bg-[#101012] px-3 py-2.5 font-mono text-sm font-bold text-foreground select-all break-all">
                    {tempPasswordModal.password}
                  </div>
                  <button
                    type="button"
                    onClick={copyPassword}
                    className="inline-flex min-h-[42px] items-center gap-1.5 rounded bg-primary/20 hover:bg-primary/30 border border-primary/30 px-3 py-2 text-xs font-bold text-primary transition-colors"
                  >
                    {copied ? (
                      <>
                        <Check className="h-4 w-4 text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end pt-4 border-t border-border">
              <button
                type="button"
                onClick={() => setTempPasswordModal(null)}
                className="rounded bg-primary px-5 py-2 text-xs font-bold text-primary-foreground hover:bg-primary-hover"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
