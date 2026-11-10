"use client";

import * as React from "react";
import {
  Sparkles,
  Plus,
  Edit2,
  Tag,
  Search,
  AlertCircle,
  Loader2,
  X,
  Power,
  Percent,
} from "lucide-react";
import type {
  AdminServiceList,
  AdminServiceItem,
  AdminServiceOfferInput,
} from "@/types/admin-contracts";
import type { UserRole } from "@/types/contracts";
import type { CatalogServiceKind, PriceUnit } from "@/types/catalog-contracts";
import { adminRequest } from "./bookings/client";
import { useAdminResource } from "./bookings/use-admin-resource";

interface ServicesTabProps {
  role: UserRole;
}

const CATEGORY_LABELS: Record<CatalogServiceKind, string> = {
  WASH: "Car Wash",
  DETAILING: "Detailing",
  GRAPHENE: "Graphene / Ceramic",
  TINT: "Window Tint",
  PPF: "Paint Protection Film",
  REPAINT: "Repaint & Correction",
};

const CATEGORY_COLORS: Record<CatalogServiceKind, string> = {
  WASH: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  DETAILING: "border-blue-500/30 bg-blue-500/10 text-blue-400",
  GRAPHENE: "border-purple-500/30 bg-purple-500/10 text-purple-400",
  TINT: "border-cyan-500/30 bg-cyan-500/10 text-cyan-400",
  PPF: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  REPAINT: "border-rose-500/30 bg-rose-500/10 text-rose-400",
};

const SIZE_ORDER = ["MOTOR", "S", "M", "L", "XL"] as const;
const SIZE_NAMES: Record<string, string> = {
  MOTOR: "Motorcycle",
  S: "Small",
  M: "Medium",
  L: "Large",
  XL: "Extra Large",
};

function formatCentavos(centavos: number | null): string {
  if (centavos === null) return "—";
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(centavos / 100);
}

export function ServicesTab({ role }: ServicesTabProps) {
  void role;
  const resource = useAdminResource<AdminServiceList>("/api/admin/services");
  const data = resource.data;
  const services = data?.services ?? [];

  const [selectedCategory, setSelectedCategory] = React.useState<string>("ALL");
  const [searchQuery, setSearchQuery] = React.useState<string>("");

  // Edit modal state
  const [editService, setEditService] = React.useState<AdminServiceItem | null>(null);
  const [editName, setEditName] = React.useState("");
  const [editDesc, setEditDesc] = React.useState("");
  const [editCategory, setEditCategory] = React.useState<CatalogServiceKind>("WASH");
  const [editOffers, setEditOffers] = React.useState<Record<string, {
    offered: boolean;
    pricePhp: string;
    comparePhp: string;
  }>>({});
  const [editSaving, setEditSaving] = React.useState(false);
  const [editError, setEditError] = React.useState<string | null>(null);

  // Create modal state
  const [createOpen, setCreateOpen] = React.useState(false);
  const [createName, setCreateName] = React.useState("");
  const [createDesc, setCreateDesc] = React.useState("");
  const [createCategory, setCreateCategory] = React.useState<CatalogServiceKind>("WASH");
  const [createType, setCreateType] = React.useState<"BASE" | "ADD_ON">("BASE");
  const [createUnit, setCreateUnit] = React.useState<PriceUnit>("VEHICLE");
  const [createOffers, setCreateOffers] = React.useState<Record<string, {
    offered: boolean;
    pricePhp: string;
    comparePhp: string;
  }>>({});
  const [createSaving, setCreateSaving] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);

  // Toggle active state
  const [togglingId, setTogglingId] = React.useState<string | null>(null);

  const initEditModal = (svc: AdminServiceItem) => {
    setEditService(svc);
    setEditName(svc.name);
    setEditDesc(svc.description ?? "");
    setEditCategory(svc.category);
    const offerMap: Record<string, { offered: boolean; pricePhp: string; comparePhp: string }> = {};
    for (const size of SIZE_ORDER) {
      const off = svc.offers.find((o) => o.sizeCode === size);
      offerMap[size] = {
        offered: off?.state !== "NOT_OFFERED",
        pricePhp: off?.unitPriceCentavos ? (off.unitPriceCentavos / 100).toString() : "",
        comparePhp: off?.compareAtCentavos ? (off.compareAtCentavos / 100).toString() : "",
      };
    }
    setEditOffers(offerMap);
    setEditError(null);
  };

  const initCreateModal = () => {
    setCreateName("");
    setCreateDesc("");
    setCreateCategory("WASH");
    setCreateType("BASE");
    setCreateUnit("VEHICLE");
    const offerMap: Record<string, { offered: boolean; pricePhp: string; comparePhp: string }> = {};
    for (const size of SIZE_ORDER) {
      offerMap[size] = { offered: true, pricePhp: "", comparePhp: "" };
    }
    setCreateOffers(offerMap);
    setCreateError(null);
    setCreateOpen(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editService) return;
    setEditSaving(true);
    setEditError(null);

    const offersPayload: AdminServiceOfferInput[] = SIZE_ORDER.map((size) => {
      const priceNum = parseFloat(editOffers[size]?.pricePhp || "0");
      const compareNum = parseFloat(editOffers[size]?.comparePhp || "0");
      return {
        sizeCode: size,
        state: editOffers[size]?.offered ? (priceNum > 0 ? "OFFERED" : "UNCONFIRMED") : "NOT_OFFERED",
        unitPriceCentavos: editOffers[size]?.offered && priceNum > 0 ? Math.round(priceNum * 100) : null,
        compareAtCentavos: editOffers[size]?.offered && compareNum > 0 ? Math.round(compareNum * 100) : null,
      };
    });

    try {
      await adminRequest(`/api/admin/services/${editService.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editName,
          description: editDesc || null,
          category: editCategory,
          offers: offersPayload,
        }),
      });
      setEditService(null);
      resource.reload();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to update service");
    } finally {
      setEditSaving(false);
    }
  };

  const handleSaveCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName.trim()) {
      setCreateError("Service name is required");
      return;
    }
    setCreateSaving(true);
    setCreateError(null);

    const offersPayload: AdminServiceOfferInput[] = SIZE_ORDER.map((size) => {
      const priceNum = parseFloat(createOffers[size]?.pricePhp || "0");
      const compareNum = parseFloat(createOffers[size]?.comparePhp || "0");
      return {
        sizeCode: size,
        state: createOffers[size]?.offered ? (priceNum > 0 ? "OFFERED" : "UNCONFIRMED") : "NOT_OFFERED",
        unitPriceCentavos: createOffers[size]?.offered && priceNum > 0 ? Math.round(priceNum * 100) : null,
        compareAtCentavos: createOffers[size]?.offered && compareNum > 0 ? Math.round(compareNum * 100) : null,
      };
    });

    try {
      await adminRequest("/api/admin/services", {
        method: "POST",
        body: JSON.stringify({
          name: createName,
          description: createDesc || null,
          category: createCategory,
          type: createType,
          unit: createUnit,
          offers: offersPayload,
        }),
      });
      setCreateOpen(false);
      resource.reload();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create service");
    } finally {
      setCreateSaving(false);
    }
  };

  const handleToggleActive = async (svc: AdminServiceItem) => {
    setTogglingId(svc.id);
    try {
      if (svc.isActive) {
        await adminRequest(`/api/admin/services/${svc.id}`, { method: "DELETE" });
      } else {
        await adminRequest(`/api/admin/services/${svc.id}`, { method: "POST" });
      }
      resource.reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to change service state");
    } finally {
      setTogglingId(null);
    }
  };

  const filteredServices = services.filter((s) => {
    if (selectedCategory !== "ALL" && s.category !== selectedCategory) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return s.name.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q);
    }
    return true;
  });

  const discountedCount = services.filter((s) =>
    s.offers.some((o) => o.compareAtCentavos && o.unitPriceCentavos && o.compareAtCentavos > o.unitPriceCentavos)
  ).length;

  return (
    <div className="space-y-6">
      {/* Header and Stats */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Service Catalog & Pricing
          </h2>
          <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
            Manage packages, vehicle size prices, and promotional discounts reflected on the customer booking page.
          </p>
        </div>
        <button
          type="button"
          onClick={initCreateModal}
          className="inline-flex min-h-[40px] items-center gap-2 rounded bg-primary px-4 py-2 text-xs font-bold text-primary-foreground hover:bg-primary-hover shadow-sm transition-colors"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>Add Service</span>
        </button>
      </div>

      {/* Metrics Banner */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded border border-border bg-[#141416] p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Total Services</p>
          <p className="mt-1 text-xl font-bold text-foreground">{services.length}</p>
        </div>
        <div className="rounded border border-border bg-[#141416] p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Active Online</p>
          <p className="mt-1 text-xl font-bold text-emerald-400">
            {services.filter((s) => s.isActive).length}
          </p>
        </div>
        <div className="rounded border border-border bg-[#141416] p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">On Promo / Discount</p>
          <p className="mt-1 text-xl font-bold text-amber-400">{discountedCount}</p>
        </div>
        <div className="rounded border border-border bg-[#141416] p-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Categories</p>
          <p className="mt-1 text-xl font-bold text-foreground">{Object.keys(CATEGORY_LABELS).length} Service Categories</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 rounded border border-border bg-[#141416] p-4 lg:flex-row lg:items-center lg:justify-between">
        {/* Category Pills */}
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setSelectedCategory("ALL")}
            className={`min-h-[36px] rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
              selectedCategory === "ALL"
                ? "bg-primary text-primary-foreground"
                : "border border-border text-muted-foreground hover:bg-[#1a1a1e] hover:text-foreground"
            }`}
          >
            All ({services.length})
          </button>
          {(Object.keys(CATEGORY_LABELS) as CatalogServiceKind[]).map((cat) => {
            const count = services.filter((s) => s.category === cat).length;
            const active = selectedCategory === cat;
            return (
              <button
                type="button"
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`min-h-[36px] rounded px-3 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground hover:bg-[#1a1a1e] hover:text-foreground"
                }`}
              >
                {CATEGORY_LABELS[cat]} ({count})
              </button>
            );
          })}
        </div>

        {/* Search Input */}
        <div className="relative min-w-[240px]">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search service name or desc..."
            className="w-full rounded border border-border bg-[#18181b] py-2 pl-9 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* Services List */}
      {resource.loading && (
        <div className="flex h-48 items-center justify-center rounded border border-border bg-[#141416]">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <span className="ml-2 text-xs text-muted-foreground">Loading service catalog...</span>
        </div>
      )}

      {!resource.loading && filteredServices.length === 0 && (
        <div className="flex h-48 flex-col items-center justify-center rounded border border-dashed border-border bg-[#141416] p-8 text-center">
          <Tag className="h-8 w-8 text-muted-foreground/50" />
          <p className="mt-2 text-sm font-semibold text-foreground">No services found</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {searchQuery ? "Try refining your search filter." : "Get started by adding a service."}
          </p>
        </div>
      )}

      <div className="space-y-4">
        {filteredServices.map((svc) => {
          const hasDiscount = svc.offers.some(
            (o) => o.compareAtCentavos && o.unitPriceCentavos && o.compareAtCentavos > o.unitPriceCentavos
          );
          return (
            <div
              key={svc.id}
              className={`rounded border border-border bg-[#141416] p-4 transition-all hover:border-[#38383e] ${
                !svc.isActive ? "opacity-60" : ""
              }`}
            >
              {/* Card Header */}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-bold text-foreground">{svc.name}</h3>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                        CATEGORY_COLORS[svc.category] ?? "border-border text-muted-foreground"
                      }`}
                    >
                      {CATEGORY_LABELS[svc.category] ?? svc.category}
                    </span>
                    <span className="inline-flex items-center rounded border border-border/60 bg-[#18181b] px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      {svc.type === "BASE" ? "Main Package" : "Add-on"}
                    </span>
                    {hasDiscount && (
                      <span className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                        <Percent className="h-3 w-3" />
                        Discount Active
                      </span>
                    )}
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        svc.isActive
                          ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                          : "border border-zinc-700 bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${svc.isActive ? "bg-emerald-400" : "bg-zinc-400"}`} />
                      {svc.isActive ? "Active Online" : "Hidden"}
                    </span>
                  </div>
                  {svc.description && (
                    <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2 max-w-3xl">
                      {svc.description}
                    </p>
                  )}
                </div>

                {/* Card Action Buttons */}
                <div className="flex items-center gap-2 self-start pt-1 sm:pt-0">
                  <button
                    type="button"
                    onClick={() => initEditModal(svc)}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded border border-border bg-[#18181b] px-3 py-1 text-xs font-semibold text-foreground hover:bg-[#202025] hover:border-primary transition-colors"
                  >
                    <Edit2 className="h-3.5 w-3.5 text-primary" />
                    <span>Edit Pricing</span>
                  </button>
                  <button
                    type="button"
                    disabled={togglingId === svc.id}
                    onClick={() => handleToggleActive(svc)}
                    title={svc.isActive ? "Hide from customer booking page" : "Show on customer booking page"}
                    className={`inline-flex min-h-[36px] items-center gap-1.5 rounded border px-3 py-1 text-xs font-semibold transition-colors ${
                      svc.isActive
                        ? "border-border text-muted-foreground hover:text-rose-400 hover:border-rose-500/40"
                        : "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                    }`}
                  >
                    <Power className="h-3.5 w-3.5" />
                    <span>{svc.isActive ? "Deactivate" : "Activate"}</span>
                  </button>
                </div>
              </div>

              {/* Size Pricing Grid */}
              <div className="mt-4 border-t border-border pt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Pricing by Vehicle Size
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {SIZE_ORDER.map((size) => {
                    const off = svc.offers.find((o) => o.sizeCode === size);
                    const isOffered = off && off.state !== "NOT_OFFERED";
                    const isDiscounted =
                      isOffered &&
                      off.compareAtCentavos &&
                      off.unitPriceCentavos &&
                      off.compareAtCentavos > off.unitPriceCentavos;
                    const discountPercent = isDiscounted
                      ? Math.round(
                          ((off.compareAtCentavos! - off.unitPriceCentavos!) / off.compareAtCentavos!) * 100
                        )
                      : null;

                    return (
                      <div
                        key={size}
                        className={`rounded border p-2 text-center transition-colors ${
                          !isOffered
                            ? "border-border/40 bg-[#101012] opacity-50"
                            : isDiscounted
                            ? "border-emerald-500/30 bg-emerald-500/5"
                            : "border-border bg-[#18181b]"
                        }`}
                      >
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          {SIZE_NAMES[size]}
                        </p>
                        <div className="mt-1">
                          {isOffered ? (
                            off.unitPriceCentavos !== null ? (
                              <div className="space-y-0.5">
                                {isDiscounted && (
                                  <div className="flex items-center justify-center gap-1.5">
                                    <span className="text-[11px] text-muted-foreground line-through">
                                      {formatCentavos(off.compareAtCentavos)}
                                    </span>
                                    <span className="rounded bg-emerald-500/20 px-1 py-0.2 text-[9px] font-black text-emerald-400">
                                      {discountPercent}% OFF
                                    </span>
                                  </div>
                                )}
                                <p
                                  className={`text-xs font-black ${
                                    isDiscounted ? "text-emerald-400" : "text-foreground"
                                  }`}
                                >
                                  {formatCentavos(off.unitPriceCentavos)}
                                </p>
                              </div>
                            ) : (
                              <span className="text-xs font-semibold text-amber-400">For Quote</span>
                            )
                          ) : (
                            <span className="text-xs text-muted-foreground/60">— Not Offered</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Edit Service & Pricing Modal */}
      {editService && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 overflow-y-auto"
        >
          <div className="w-full max-w-2xl rounded-xl border border-border bg-[#141416] p-6 shadow-2xl space-y-5 my-8">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-bold text-foreground">Edit Service & Pricing</h3>
              </div>
              <button
                type="button"
                onClick={() => setEditService(null)}
                className="rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {editError && (
              <div className="flex items-center gap-2 rounded border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-400">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{editError}</span>
              </div>
            )}

            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground">Service Name *</label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="mt-1 w-full rounded border border-border bg-[#18181b] px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground">Category *</label>
                  <select
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value as CatalogServiceKind)}
                    className="mt-1 w-full rounded border border-border bg-[#18181b] px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                  >
                    {(Object.keys(CATEGORY_LABELS) as CatalogServiceKind[]).map((cat) => (
                      <option key={cat} value={cat}>
                        {CATEGORY_LABELS[cat]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground">Description</label>
                <textarea
                  rows={2}
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  placeholder="Included inclusions, warranty, description..."
                  className="mt-1 w-full rounded border border-border bg-[#18181b] px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                />
              </div>

              {/* Pricing & Discounts per size */}
              <div className="space-y-2 border-t border-border pt-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-primary">
                    Pricing & Promo Discounts per Vehicle Size
                  </h4>
                  <span className="text-[11px] text-muted-foreground">Amounts in PHP (₱)</span>
                </div>

                <div className="space-y-2.5">
                  {SIZE_ORDER.map((size) => {
                    const cur = editOffers[size] ?? { offered: true, pricePhp: "", comparePhp: "" };
                    const price = parseFloat(cur.pricePhp || "0");
                    const compare = parseFloat(cur.comparePhp || "0");
                    const hasDiscount = cur.offered && compare > price && price > 0;
                    const discountPct = hasDiscount ? Math.round(((compare - price) / compare) * 100) : 0;

                    return (
                      <div
                        key={size}
                        className={`rounded border p-3 transition-colors ${
                          !cur.offered
                            ? "border-border/40 bg-[#101012] opacity-60"
                            : hasDiscount
                            ? "border-emerald-500/30 bg-emerald-500/5"
                            : "border-border bg-[#18181b]"
                        }`}
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <label className="flex items-center gap-2 cursor-pointer min-w-[130px]">
                            <input
                              type="checkbox"
                              checked={cur.offered}
                              onChange={(e) =>
                                setEditOffers((prev) => ({
                                  ...prev,
                                  [size]: { ...cur, offered: e.target.checked },
                                }))
                              }
                              className="h-4 w-4 rounded border-border accent-primary"
                            />
                            <span className="text-xs font-bold text-foreground">{SIZE_NAMES[size]}</span>
                          </label>

                          {cur.offered ? (
                            <div className="flex flex-1 flex-wrap items-center gap-3 justify-end">
                              <div>
                                <label className="block text-[10px] font-semibold text-muted-foreground">
                                  Original / Regular Price (₱)
                                </label>
                                <input
                                  type="number"
                                  step="any"
                                  placeholder="e.g. 500"
                                  value={cur.comparePhp}
                                  onChange={(e) =>
                                    setEditOffers((prev) => ({
                                      ...prev,
                                      [size]: { ...cur, comparePhp: e.target.value },
                                    }))
                                  }
                                  className="w-28 rounded border border-border bg-[#121214] px-2.5 py-1 text-xs text-foreground focus:border-primary focus:outline-none"
                                />
                              </div>

                              <div>
                                <label className="block text-[10px] font-semibold text-primary">
                                  Selling / Promo Price (₱) *
                                </label>
                                <input
                                  type="number"
                                  step="any"
                                  placeholder="e.g. 450"
                                  value={cur.pricePhp}
                                  onChange={(e) =>
                                    setEditOffers((prev) => ({
                                      ...prev,
                                      [size]: { ...cur, pricePhp: e.target.value },
                                    }))
                                  }
                                  className="w-28 rounded border border-primary/50 bg-[#121214] px-2.5 py-1 text-xs font-bold text-foreground focus:border-primary focus:outline-none"
                                />
                              </div>

                              {hasDiscount && (
                                <div className="self-end pb-1">
                                  <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 border border-emerald-500/30 px-2 py-1 text-[11px] font-black text-emerald-400">
                                    {discountPct}% OFF
                                  </span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs italic text-muted-foreground">Service not offered for this size</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setEditService(null)}
                  className="rounded border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-[#18181b] hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editSaving}
                  className="inline-flex items-center gap-2 rounded bg-primary px-5 py-2 text-xs font-bold text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
                >
                  {editSaving ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>Save Service & Prices</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Service Modal */}
      {createOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 overflow-y-auto"
        >
          <div className="w-full max-w-2xl rounded-xl border border-border bg-[#141416] p-6 shadow-2xl space-y-5 my-8">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <Plus className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-bold text-foreground">Add New Service</h3>
              </div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {createError && (
              <div className="flex items-center gap-2 rounded border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-400">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{createError}</span>
              </div>
            )}

            <form onSubmit={handleSaveCreate} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground">Service Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Engine Bay Detail"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    className="mt-1 w-full rounded border border-border bg-[#18181b] px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground">Category *</label>
                  <select
                    value={createCategory}
                    onChange={(e) => setCreateCategory(e.target.value as CatalogServiceKind)}
                    className="mt-1 w-full rounded border border-border bg-[#18181b] px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                  >
                    {(Object.keys(CATEGORY_LABELS) as CatalogServiceKind[]).map((cat) => (
                      <option key={cat} value={cat}>
                        {CATEGORY_LABELS[cat]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground">Service Type</label>
                  <select
                    value={createType}
                    onChange={(e) => setCreateType(e.target.value as "BASE" | "ADD_ON")}
                    className="mt-1 w-full rounded border border-border bg-[#18181b] px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                  >
                    <option value="BASE">Main Package (Standalone)</option>
                    <option value="ADD_ON">Add-on Service</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground">Pricing Unit</label>
                  <select
                    value={createUnit}
                    onChange={(e) => setCreateUnit(e.target.value as PriceUnit)}
                    className="mt-1 w-full rounded border border-border bg-[#18181b] px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                  >
                    <option value="VEHICLE">Per Vehicle</option>
                    <option value="PANEL">Per Panel</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground">Description</label>
                <textarea
                  rows={2}
                  value={createDesc}
                  onChange={(e) => setCreateDesc(e.target.value)}
                  placeholder="Included inclusions, warranty, details..."
                  className="mt-1 w-full rounded border border-border bg-[#18181b] px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                />
              </div>

              {/* Pricing & Discounts per size */}
              <div className="space-y-2 border-t border-border pt-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-primary">
                    Initial Pricing & Discounts per Vehicle Size
                  </h4>
                  <span className="text-[11px] text-muted-foreground">Amounts in PHP (₱)</span>
                </div>

                <div className="space-y-2.5">
                  {SIZE_ORDER.map((size) => {
                    const cur = createOffers[size] ?? { offered: true, pricePhp: "", comparePhp: "" };
                    const price = parseFloat(cur.pricePhp || "0");
                    const compare = parseFloat(cur.comparePhp || "0");
                    const hasDiscount = cur.offered && compare > price && price > 0;
                    const discountPct = hasDiscount ? Math.round(((compare - price) / compare) * 100) : 0;

                    return (
                      <div
                        key={size}
                        className={`rounded border p-3 transition-colors ${
                          !cur.offered
                            ? "border-border/40 bg-[#101012] opacity-60"
                            : hasDiscount
                            ? "border-emerald-500/30 bg-emerald-500/5"
                            : "border-border bg-[#18181b]"
                        }`}
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <label className="flex items-center gap-2 cursor-pointer min-w-[130px]">
                            <input
                              type="checkbox"
                              checked={cur.offered}
                              onChange={(e) =>
                                setCreateOffers((prev) => ({
                                  ...prev,
                                  [size]: { ...cur, offered: e.target.checked },
                                }))
                              }
                              className="h-4 w-4 rounded border-border accent-primary"
                            />
                            <span className="text-xs font-bold text-foreground">{SIZE_NAMES[size]}</span>
                          </label>

                          {cur.offered ? (
                            <div className="flex flex-1 flex-wrap items-center gap-3 justify-end">
                              <div>
                                <label className="block text-[10px] font-semibold text-muted-foreground">
                                  Original Price (₱)
                                </label>
                                <input
                                  type="number"
                                  step="any"
                                  placeholder="e.g. 500"
                                  value={cur.comparePhp}
                                  onChange={(e) =>
                                    setCreateOffers((prev) => ({
                                      ...prev,
                                      [size]: { ...cur, comparePhp: e.target.value },
                                    }))
                                  }
                                  className="w-28 rounded border border-border bg-[#121214] px-2.5 py-1 text-xs text-foreground focus:border-primary focus:outline-none"
                                />
                              </div>

                              <div>
                                <label className="block text-[10px] font-semibold text-primary">
                                  Selling Price (₱)
                                </label>
                                <input
                                  type="number"
                                  step="any"
                                  placeholder="e.g. 450"
                                  value={cur.pricePhp}
                                  onChange={(e) =>
                                    setCreateOffers((prev) => ({
                                      ...prev,
                                      [size]: { ...cur, pricePhp: e.target.value },
                                    }))
                                  }
                                  className="w-28 rounded border border-primary/50 bg-[#121214] px-2.5 py-1 text-xs font-bold text-foreground focus:border-primary focus:outline-none"
                                />
                              </div>

                              {hasDiscount && (
                                <div className="self-end pb-1">
                                  <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 border border-emerald-500/30 px-2 py-1 text-[11px] font-black text-emerald-400">
                                    {discountPct}% OFF
                                  </span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs italic text-muted-foreground">Not offered for this size</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="rounded border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-[#18181b] hover:text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createSaving}
                  className="inline-flex items-center gap-2 rounded bg-primary px-5 py-2 text-xs font-bold text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
                >
                  {createSaving ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Creating...</span>
                    </>
                  ) : (
                    <span>Create Service</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
