"use client";
import * as React from "react";
import {
  UserPlus,
  Search,
  Filter,
  Edit2,
  Trash2,
  Percent,
  Briefcase,
  Phone,
  Calendar,
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  Loader2,
  X,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { basisPointsToPercent, formatPesos } from "@/lib/commission";
import type {
  AdminStaffProfile,
  AdminTeam,
  AdminTeamPerson,
  AdminTeamPersonDetail,
  AdminTeamRemoveOutcome,
  AdminTeamRemovePreview,
} from "@/types/admin-contracts";
import { adminRequest, AdminRequestError } from "../bookings/client";
import { ratePhrase, removeResult } from "./team-model";

export function describeError(e: unknown): string {
  if (e instanceof AdminRequestError) {
    const field = Object.values(e.fieldErrors)[0]?.[0];
    return field ? `${e.message} ${field}` : e.message;
  }
  return "Could not save. Please retry.";
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (!parts[0]) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

type ProfileForm = {
  name: string;
  phone: string;
  rate: string;
  nickname: string;
  position: string;
  contactEmail: string;
  address: string;
  birthDate: string;
  hiredOn: string;
  emergencyName: string;
  emergencyPhone: string;
  notes: string;
};

const EMPTY_FORM: ProfileForm = {
  name: "",
  phone: "",
  rate: "",
  nickname: "",
  position: "",
  contactEmail: "",
  address: "",
  birthDate: "",
  hiredOn: "",
  emergencyName: "",
  emergencyPhone: "",
  notes: "",
};

export function TeamPanel({ team, reload }: { team: AdminTeam; reload: () => unknown }) {
  const [form, setForm] = React.useState<ProfileForm>(EMPTY_FORM);
  const [modalMode, setModalMode] = React.useState<"new" | "edit" | null>(null);
  const [activePerson, setActivePerson] = React.useState<AdminTeamPerson | null>(null);
  const [modalLoading, setModalLoading] = React.useState(false);
  const [removing, setRemoving] = React.useState<AdminTeamPerson | null>(null);
  const [preview, setPreview] = React.useState<AdminTeamRemovePreview | null>(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  // Search & Filter state
  const [searchTerm, setSearchTerm] = React.useState("");
  const [positionFilter, setPositionFilter] = React.useState<string>("ALL");
  const [statusFilter, setStatusFilter] = React.useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL");

  // Pagination state
  const [currentPage, setCurrentPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(10);

  const writing = React.useRef(false);
  const clientId = React.useRef<string>("");

  async function run(work: () => Promise<string | null>) {
    if (writing.current) return false;
    writing.current = true;
    setBusy(true);
    setError(null);
    try {
      const message = await work();
      await reload();
      setNotice(message);
      return true;
    } catch (e) {
      setError(describeError(e));
      if (e instanceof AdminRequestError && e.status === 409) await reload();
      return false;
    } finally {
      writing.current = false;
      setBusy(false);
    }
  }

  function openNew() {
    setError(null);
    clientId.current = crypto.randomUUID();
    setForm(EMPTY_FORM);
    setActivePerson(null);
    setModalLoading(false);
    setModalMode("new");
  }

  function openEdit(person: AdminTeamPerson) {
    setError(null);
    setActivePerson(person);
    setModalLoading(true);
    setModalMode("edit");
    setForm({
      name: person.name,
      phone: person.phone,
      rate: person.commissionRateBp === null ? "" : basisPointsToPercent(person.commissionRateBp),
      nickname: person.nickname ?? "",
      position: person.position ?? "",
      contactEmail: "",
      address: "",
      birthDate: "",
      hiredOn: person.hiredOn ?? "",
      emergencyName: "",
      emergencyPhone: "",
      notes: "",
    });
    adminRequest<AdminTeamPersonDetail>(`/api/admin/team/${person.id}`)
      .then((data) => {
        setForm({
          name: data.person.name,
          phone: data.person.phone,
          rate: data.person.commissionRateBp === null ? "" : basisPointsToPercent(data.person.commissionRateBp),
          nickname: data.profile.nickname ?? "",
          position: data.profile.position ?? "",
          contactEmail: data.profile.contactEmail ?? "",
          address: data.profile.address ?? "",
          birthDate: data.profile.birthDate ?? "",
          hiredOn: data.profile.hiredOn ?? "",
          emergencyName: data.profile.emergencyName ?? "",
          emergencyPhone: data.profile.emergencyPhone ?? "",
          notes: data.profile.notes ?? "",
        });
      })
      .catch((e) => setError(describeError(e)))
      .finally(() => setModalLoading(false));
  }

  async function openRemove(person: AdminTeamPerson) {
    setError(null);
    setRemoving(person);
    setPreview(null);
    setPreviewLoading(true);
    try {
      const data = await adminRequest<AdminTeamRemovePreview>(`/api/admin/team/${person.id}/remove-preview`);
      setPreview(data);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setPreviewLoading(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!modalMode) return;
    const rate = form.rate.trim();
    const profilePayload: AdminStaffProfile = {
      nickname: form.nickname.trim() || null,
      position: form.position.trim() || null,
      contactEmail: form.contactEmail.trim() || null,
      address: form.address.trim() || null,
      birthDate: form.birthDate.trim() || null,
      hiredOn: form.hiredOn.trim() || null,
      emergencyName: form.emergencyName.trim() || null,
      emergencyPhone: form.emergencyPhone.trim() || null,
      notes: form.notes.trim() || null,
    };

    const ok = await run(async () => {
      if (modalMode === "new") {
        await adminRequest("/api/admin/team", {
          method: "POST",
          body: {
            id: clientId.current,
            name: form.name.trim(),
            ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
            ...(rate ? { ratePercent: rate } : {}),
            profile: profilePayload,
          },
        });
        return `${form.name.trim()} was added to the team.`;
      }
      if (!activePerson) return null;
      await adminRequest(`/api/admin/team/${activePerson.id}`, {
        method: "PATCH",
        body: {
          expectedRevision: activePerson.revision,
          name: form.name.trim(),
          phone: form.phone.trim(),
          ratePercent: rate ? rate : null,
          profile: profilePayload,
        },
      });
      return `${form.name.trim()} was updated.`;
    });
    if (ok) {
      setModalMode(null);
      setActivePerson(null);
    }
  }

  async function confirmRemove() {
    const p = removing;
    if (!p) return;
    const ok = await run(async () => {
      const result = await adminRequest<{ outcome: AdminTeamRemoveOutcome }>(`/api/admin/team/${p.id}/remove`, {
        method: "POST",
        body: { expectedRevision: p.revision },
      });
      return removeResult(result.outcome, p.name);
    });
    if (ok) {
      setRemoving(null);
      setModalMode(null);
      setActivePerson(null);
    }
  }

  // Extract unique positions for filter dropdown
  const uniquePositions = React.useMemo(() => {
    const positions = new Set<string>();
    team.people.forEach((p) => {
      if (p.position && p.position.trim()) {
        positions.add(p.position.trim());
      }
    });
    return Array.from(positions).sort();
  }, [team.people]);

  // Filtered staff list
  const filteredPeople = React.useMemo(() => {
    return team.people.filter((p) => {
      // Status filter
      if (statusFilter === "ACTIVE" && !p.isActive) return false;
      if (statusFilter === "INACTIVE" && p.isActive) return false;

      // Position filter
      if (positionFilter !== "ALL" && (p.position || "Detailer") !== positionFilter) {
        return false;
      }

      // Search term (name, phone, nickname)
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const matchesName = p.name.toLowerCase().includes(query);
        const matchesPhone = p.phone ? p.phone.toLowerCase().includes(query) : false;
        const matchesNick = p.nickname ? p.nickname.toLowerCase().includes(query) : false;
        const matchesPos = p.position ? p.position.toLowerCase().includes(query) : false;
        return matchesName || matchesPhone || matchesNick || matchesPos;
      }

      return true;
    });
  }, [team.people, statusFilter, positionFilter, searchTerm]);

  // Metric summaries
  const totalStaff = team.people.length;
  const activeStaff = team.people.filter((p) => p.isActive).length;
  const totalOpenJobs = team.people.reduce((sum, p) => sum + p.openJobs, 0);

  // Pagination calculations
  const totalPages = Math.max(1, Math.ceil(filteredPeople.length / pageSize));
  const currentPageSafe = Math.min(currentPage, totalPages);
  const startIndex = (currentPageSafe - 1) * pageSize;
  const paginatedPeople = filteredPeople.slice(startIndex, startIndex + pageSize);

  return (
    <div className="space-y-6">
      {/* Top Header / Title & Metric Cards */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground">Staff & Detailers</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manage your shop technicians, assign default commission rates, and track active workloads.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="gold"
            className="min-h-[40px] shadow-sm font-semibold text-xs gap-1.5"
            onClick={openNew}
          >
            <UserPlus className="h-4 w-4" />
            Add Staff Member
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-panel p-4 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Total Technicians</p>
            <p className="text-2xl font-bold text-foreground mt-1">{totalStaff}</p>
            <p className="text-xs text-muted-foreground mt-0.5">All registered shop staff</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-raised text-primary">
            <User className="h-5 w-5" />
          </div>
        </div>

        <div className="rounded-xl border border-border bg-panel p-4 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Active on Duty</p>
            <p className="text-2xl font-bold text-emerald-400 mt-1">{activeStaff}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Available for day queue assign</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-raised text-emerald-400">
            <CheckCircle2 className="h-5 w-5" />
          </div>
        </div>

        <div className="rounded-xl border border-border bg-panel p-4 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Active Job Assignments</p>
            <p className="text-2xl font-bold text-amber-400 mt-1">{totalOpenJobs}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Ongoing detailing/wash tasks</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-raised text-amber-400">
            <Briefcase className="h-5 w-5" />
          </div>
        </div>
      </div>

      {/* Action / Notification Banner */}
      {notice && (
        <div className="flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-400">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{notice}</span>
          </div>
          <button type="button" onClick={() => setNotice(null)} className="text-emerald-400/70 hover:text-emerald-400">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {error && !modalMode && !removing && (
        <div className="flex items-center justify-between rounded-lg border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-xs text-rose-400">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button type="button" onClick={() => setError(null)} className="text-rose-400/70 hover:text-rose-400">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Main Table Container */}
      <div className="rounded-xl border border-border bg-panel shadow-sm">
        {/* Filters and Search Bar */}
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Search by name, phone, position..."
              className="w-full rounded-md border border-border bg-raised pl-9 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-raised px-2.5 py-1 text-xs text-muted-foreground">
              <Filter className="h-3 w-3" />
              <span>Position:</span>
              <select
                value={positionFilter}
                onChange={(e) => {
                  setPositionFilter(e.target.value);
                  setCurrentPage(1);
                }}
                className="bg-transparent text-xs text-foreground focus:outline-none"
              >
                <option value="ALL">All Positions</option>
                {uniquePositions.map((pos) => (
                  <option key={pos} value={pos}>
                    {pos}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5 rounded-md border border-border bg-raised px-2.5 py-1 text-xs text-muted-foreground">
              <span>Status:</span>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as "ALL" | "ACTIVE" | "INACTIVE");
                  setCurrentPage(1);
                }}
                className="bg-transparent text-xs text-foreground focus:outline-none"
              >
                <option value="ALL">All Status</option>
                <option value="ACTIVE">Active Only</option>
                <option value="INACTIVE">Inactive Only</option>
              </select>
            </div>
          </div>
        </div>

        {/* Data Table */}
        {filteredPeople.length === 0 ? (
          <div className="p-12 text-center text-xs text-muted-foreground">
            {team.people.length === 0
              ? "No staff members registered yet. Click 'Add Staff Member' to get started."
              : "No staff matching your search and filter criteria."}
          </div>
        ) : (
          <div className="divide-y divide-border">
            <div className="hidden grid-cols-12 gap-3 px-6 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider sm:grid bg-panel">
              <div className="col-span-4">Staff Member</div>
              <div className="col-span-3">Contact & Details</div>
              <div className="col-span-3">Commission & Workload</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>

            <ul className="divide-y divide-border">
              {paginatedPeople.map((p) => {
                const effectiveRate = ratePhrase(p, team.defaultRateBp);
                return (
                  <li
                    key={p.id}
                    className="flex flex-col gap-3 p-4 transition-colors hover:bg-white/[0.02] sm:grid sm:grid-cols-12 sm:items-center sm:gap-3 sm:px-6"
                  >
                    {/* Column 1: Staff Member */}
                    <div className="col-span-4 flex items-center gap-3 min-w-0">
                      <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full border border-border bg-raised text-xs font-bold text-[#e8b44a]">
                        {getInitials(p.name)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-bold text-foreground">{p.name}</p>
                          {p.isActive ? (
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 ring-2 ring-emerald-400/20" />
                          ) : (
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-zinc-500" />
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                          <span className="inline-block rounded border border-border bg-raised px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                            {p.position || "Detailer"}
                          </span>
                          {p.nickname && (
                            <span className="text-xs text-muted-foreground">({p.nickname})</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Column 2: Contact & Details */}
                    <div className="col-span-3 text-xs text-muted-foreground space-y-0.5">
                      {p.phone ? (
                        <div className="flex items-center gap-1.5 text-foreground">
                          <Phone className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span>{p.phone}</span>
                        </div>
                      ) : (
                        <span className="text-zinc-600">No phone provided</span>
                      )}
                      {p.hiredOn && (
                        <div className="flex items-center gap-1.5 text-xs">
                          <Calendar className="h-3 w-3 shrink-0" />
                          <span>Hired: {p.hiredOn}</span>
                        </div>
                      )}
                    </div>

                    {/* Column 3: Commission & Workload */}
                    <div className="col-span-3 space-y-1">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                        <Percent className="h-3 w-3 text-primary shrink-0" />
                        <span>Commission: {effectiveRate}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Briefcase className="h-3 w-3 shrink-0" />
                        <span>
                          {p.openJobs > 0 ? (
                            <span className="font-semibold text-amber-400">
                              {p.openJobs} active {p.openJobs === 1 ? "job" : "jobs"}
                            </span>
                          ) : (
                            "No active jobs"
                          )}
                        </span>
                      </div>
                    </div>

                    {/* Column 4: Actions */}
                    <div className="col-span-2 flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => openEdit(p)}
                        className="inline-flex min-h-[34px] items-center gap-1 rounded border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-white/5 hover:text-foreground transition-colors"
                        title="Edit profile & rates"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openRemove(p)}
                        className="inline-flex min-h-[34px] items-center justify-center rounded border border-rose-950/40 bg-rose-950/10 p-1.5 text-rose-400 hover:bg-rose-950/30 transition-colors"
                        title="Remove staff"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Pagination Bar */}
        {filteredPeople.length > 0 && (
          <div className="flex flex-col gap-3 border-t border-border p-4 sm:flex-row sm:items-center sm:justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span>
                Showing <strong className="text-foreground">{startIndex + 1}</strong> to{" "}
                <strong className="text-foreground">
                  {Math.min(startIndex + pageSize, filteredPeople.length)}
                </strong>{" "}
                of <strong className="text-foreground">{filteredPeople.length}</strong> staff
              </span>
              <span className="text-zinc-600">·</span>
              <div className="flex items-center gap-1">
                <span>Rows:</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="rounded border border-border bg-raised px-1.5 py-0.5 text-xs text-foreground focus:outline-none"
                >
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={50}>50</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPageSafe <= 1}
                className="inline-flex h-8 items-center gap-1 rounded border border-border bg-raised px-2.5 text-xs font-semibold text-foreground hover:bg-white/5 disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                <span>Prev</span>
              </button>
              <div className="px-2 text-xs font-medium text-foreground">
                Page {currentPageSafe} of {totalPages}
              </div>
              <button
                type="button"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPageSafe >= totalPages}
                className="inline-flex h-8 items-center gap-1 rounded border border-border bg-raised px-2.5 text-xs font-semibold text-foreground hover:bg-white/5 disabled:opacity-40"
              >
                <span>Next</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Unified Add / Edit Staff Modal */}
      {modalMode && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="staff-modal-title"
          className="fixed inset-0 z-50 overflow-y-auto bg-black/75 p-4 sm:p-6 grid place-items-center"
        >
          <div className="relative my-auto w-full max-w-xl max-h-[calc(100vh-3rem)] rounded-xl border border-border bg-panel p-6 shadow-2xl overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-raised text-xs font-bold text-[#e8b44a]">
                  {modalMode === "new" ? <UserPlus className="h-4 w-4" /> : getInitials(form.name)}
                </div>
                <div>
                  <h3 id="staff-modal-title" className="text-base font-bold text-foreground">
                    {modalMode === "new" ? "Add Staff Member" : `Edit ${activePerson?.name}`}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {modalMode === "new"
                      ? "Register a new technician to assign jobs and earn commissions."
                      : "Update technician contact details, job title, and commission rate."}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!busy) setModalMode(null);
                }}
                className="rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {modalLoading ? (
              <div className="flex items-center justify-center p-12 text-xs text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2 text-primary" /> Loading staff details...
              </div>
            ) : (
              <form onSubmit={(e) => void save(e)} className="mt-4 space-y-4">
                {error && (
                  <div className="flex items-start gap-2 rounded-lg bg-rose-500/10 border border-rose-500/20 p-3 text-xs text-rose-400">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                {/* Section 1: Basic Information */}
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    Basic Profile
                  </h4>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-muted-foreground">Full Name *</label>
                      <input
                        type="text"
                        required
                        maxLength={80}
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        placeholder="e.g. Juan dela Cruz"
                        className="mt-1 w-full rounded border border-border bg-raised px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground">Nickname / Alias</label>
                      <input
                        type="text"
                        maxLength={40}
                        value={form.nickname}
                        onChange={(e) => setForm({ ...form, nickname: e.target.value })}
                        placeholder="e.g. Juan"
                        className="mt-1 w-full rounded border border-border bg-raised px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground">Job Title / Position</label>
                      <input
                        type="text"
                        maxLength={40}
                        value={form.position}
                        onChange={(e) => setForm({ ...form, position: e.target.value })}
                        placeholder="Detailer, Washer, Tinter..."
                        list="team-position-suggestions"
                        className="mt-1 w-full rounded border border-border bg-raised px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                      />
                      <datalist id="team-position-suggestions">
                        <option value="Detailer" />
                        <option value="Senior Detailer" />
                        <option value="Washer" />
                        <option value="Tinter" />
                        <option value="PPF Installer" />
                      </datalist>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground">Date Hired</label>
                      <input
                        type="date"
                        value={form.hiredOn}
                        onChange={(e) => setForm({ ...form, hiredOn: e.target.value })}
                        className="mt-1 w-full rounded border border-border bg-raised px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground">Birth Date</label>
                      <input
                        type="date"
                        value={form.birthDate}
                        onChange={(e) => setForm({ ...form, birthDate: e.target.value })}
                        className="mt-1 w-full rounded border border-border bg-raised px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                      />
                    </div>
                  </div>
                </div>

                {/* Section 2: Contact & Address */}
                <div className="border-t border-border pt-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    Contact & Address
                  </h4>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground">Phone Number</label>
                      <input
                        type="tel"
                        maxLength={30}
                        value={form.phone}
                        onChange={(e) => setForm({ ...form, phone: e.target.value })}
                        placeholder="e.g. +63 917 123 4567"
                        className="mt-1 w-full rounded border border-border bg-raised px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground">Personal Email</label>
                      <input
                        type="email"
                        maxLength={120}
                        value={form.contactEmail}
                        onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
                        placeholder="e.g. juan@gmail.com"
                        className="mt-1 w-full rounded border border-border bg-raised px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-muted-foreground">Residential Address</label>
                      <textarea
                        maxLength={300}
                        value={form.address}
                        onChange={(e) => setForm({ ...form, address: e.target.value })}
                        placeholder="Street, Barangay, City, Province"
                        className="mt-1 w-full rounded border border-border bg-raised px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none min-h-[60px]"
                      />
                    </div>
                  </div>
                </div>

                {/* Section 3: Commission Settings */}
                <div className="border-t border-border pt-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    Commission Rate
                  </h4>
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground">
                      Custom Commission Percentage (%)
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={form.rate}
                      onChange={(e) => setForm({ ...form, rate: e.target.value })}
                      placeholder={`Leave blank to use shop default (${basisPointsToPercent(team.defaultRateBp)}%)`}
                      className="mt-1 w-full rounded border border-border bg-raised px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Leave empty to inherit the standard shop rate (
                      {basisPointsToPercent(team.defaultRateBp)}%). Custom rate applies to all jobs credited to this detailer unless overridden by a service.
                    </p>
                  </div>
                </div>

                {/* Section 4: Emergency Contact & Notes */}
                <div className="border-t border-border pt-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    Emergency Contact & Notes
                  </h4>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground">Emergency Contact Name</label>
                      <input
                        type="text"
                        maxLength={80}
                        value={form.emergencyName}
                        onChange={(e) => setForm({ ...form, emergencyName: e.target.value })}
                        placeholder="e.g. Maria dela Cruz (Spouse)"
                        className="mt-1 w-full rounded border border-border bg-raised px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-muted-foreground">Emergency Phone</label>
                      <input
                        type="tel"
                        maxLength={30}
                        value={form.emergencyPhone}
                        onChange={(e) => setForm({ ...form, emergencyPhone: e.target.value })}
                        placeholder="e.g. +63 918 765 4321"
                        className="mt-1 w-full rounded border border-border bg-raised px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-muted-foreground">Internal Notes (Staff Only)</label>
                      <textarea
                        maxLength={1000}
                        value={form.notes}
                        onChange={(e) => setForm({ ...form, notes: e.target.value })}
                        placeholder="Specialties, certifications, internal shop notes..."
                        className="mt-1 w-full rounded border border-border bg-raised px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none min-h-[60px]"
                      />
                    </div>
                  </div>
                </div>

                {/* Modal Footer */}
                <div className="mt-6 flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-border">
                  {modalMode === "edit" && activePerson ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        const target = activePerson;
                        setModalMode(null);
                        openRemove(target);
                      }}
                      className="inline-flex items-center gap-1.5 rounded border border-rose-950/40 bg-rose-950/10 px-3 py-2 text-xs font-semibold text-rose-400 hover:bg-rose-950/30"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Remove Member</span>
                    </button>
                  ) : (
                    <div />
                  )}

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setModalMode(null)}
                      className="rounded border border-border bg-card px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
                    >
                      Cancel
                    </button>
                    <Button type="submit" variant="gold" className="min-h-[38px] text-xs font-bold" disabled={busy}>
                      {busy ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                          <span>Saving...</span>
                        </>
                      ) : modalMode === "new" ? (
                        "Add Staff Member"
                      ) : (
                        "Save Changes"
                      )}
                    </Button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Remove Confirmation Dialog */}
      <Dialog
        open={removing !== null}
        onOpenChange={(o) => {
          if (!o && !busy) setRemoving(null);
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-rose-400">
            <ShieldAlert className="h-5 w-5" />
            <span>Remove {removing?.name}?</span>
          </DialogTitle>
          <DialogDescription>
            They will be removed from active staff selection and duty rosters. Historical completed jobs and paid
            commissions will preserve their record.
          </DialogDescription>
        </DialogHeader>

        {previewLoading ? (
          <div className="py-6 flex items-center justify-center text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2 text-primary" />
            <span>Checking open jobs and unpaid commissions...</span>
          </div>
        ) : preview ? (
          <div className="my-4 space-y-3 rounded-lg border border-border bg-panel p-4 text-xs">
            <div className="flex items-start gap-2">
              <Briefcase className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-foreground">
                  {preview.openJobs.length > 0
                    ? `${preview.openJobs.length} Active Job Assignments`
                    : "No Active Jobs"}
                </p>
                <p className="text-muted-foreground text-xs mt-0.5">
                  {preview.openJobs.length > 0
                    ? `Will be unassigned from: ${preview.openJobs.map((j) => j.referenceCode).join(", ")}.`
                    : "Not currently assigned to any open jobs."}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2 pt-2 border-t border-border">
              <Percent className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-foreground">
                  {formatPesos(preview.unpaidCentavos)} Unpaid Commissions
                </p>
                <p className="text-muted-foreground text-xs mt-0.5">
                  Retained for {preview.unpaidJobs} completed {preview.unpaidJobs === 1 ? "job" : "jobs"}. You can still mark them paid on the Commissions screen.
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {error && (
          <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 p-3 text-xs text-rose-400">
            {error}
          </div>
        )}

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-[40px] text-xs"
            disabled={busy}
            onClick={() => setRemoving(null)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="min-h-[40px] text-xs font-bold"
            disabled={busy || previewLoading}
            onClick={() => void confirmRemove()}
          >
            {busy ? "Removing..." : `Confirm Remove ${removing?.name ?? "Staff"}`}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
