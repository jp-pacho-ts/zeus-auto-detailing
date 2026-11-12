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
  Ban,
  ChevronLeft,
  ChevronRight,
  Filter,
} from "lucide-react";
import type {
  AdminServiceList,
  AdminServiceItem,
  AdminServiceOfferInput,
} from "@/types/admin-contracts";
import type { UserRole } from "@/types/contracts";
import type { CatalogServiceKind, PriceUnit } from "@/types/catalog-contracts";
import { adminRequest, AdminRequestError } from "./bookings/client";
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

// A pick-up price only for L and XL, and only when it is filled in; empty means pick-ups pay the normal price.
function pickupCentavos(size: string, row: { offered: boolean; pickupPricePhp?: string }): number | null {
  const php = parseFloat(row.pickupPricePhp ?? "");
  return (size === "L" || size === "XL") && row.offered && php > 0 ? Math.round(php * 100) : null;
}

type CommissionMode = "DEFAULT" | "NONE" | "CUSTOM" | "SIZE_PERCENT" | "SIZE_FIXED";
type SizeValues = Record<string, string>;
const PER_SIZE: CommissionMode[] = ["SIZE_PERCENT", "SIZE_FIXED"];
const SIZE_LABEL: Record<string, string> = { MOTOR: "Motorcycle", S: "S", M: "M", L: "L", XL: "XL" };
// What the form sends for each commission choice (LE 2026-11-12: whole numbers; per size as % or pesos; new services start at none).
function commissionBody(mode: CommissionMode, rate: string, sizes: SizeValues) {
  const whole = (v: string) => Math.min(Number(v.replace(/\D/g, "") || "0"), mode === "SIZE_PERCENT" ? 100 : 1_000_000);
  if (mode === "SIZE_PERCENT" || mode === "SIZE_FIXED")
    return {
      commissionRatePercent: null,
      commissionMode: mode,
      sizeCommissions: SIZE_ORDER.map((sizeCode) =>
        mode === "SIZE_PERCENT" ? { sizeCode, rateBp: whole(sizes[sizeCode] ?? "") * 100 } : { sizeCode, fixedCentavos: whole(sizes[sizeCode] ?? "") * 100 }),
    };
  return { commissionRatePercent: mode === "NONE" ? "0" : mode === "CUSTOM" ? rate.trim() || null : null, commissionMode: null };
}
// The selling price of each size as typed in the form (the promo price when one applies), for the commission preview.
function sizePrices(offers: Record<string, { offered: boolean; regularPricePhp: string; hasPromo: boolean; promoPricePhp: string }>) {
  return Object.fromEntries(SIZE_ORDER.map((size) => {
    const o = offers[size];
    const regular = parseFloat(o?.regularPricePhp || "0"), promo = parseFloat(o?.promoPricePhp || "0");
    const price = o?.hasPromo && promo > 0 && promo < regular ? promo : regular;
    return [size, o?.offered && price > 0 ? price : null];
  })) as Record<string, number | null>;
}
const COMMISSION_CHOICES: { mode: CommissionMode; label: string; hint: string }[] = [
  { mode: "DEFAULT", label: "Shop default", hint: "Each worker's own rate, or the shop default." },
  { mode: "NONE", label: "None", hint: "Workers earn nothing on this service." },
  { mode: "CUSTOM", label: "One %", hint: "The same percentage of the price for every size." },
  { mode: "SIZE_PERCENT", label: "% by size", hint: "A percentage of the price, set for each size." },
  { mode: "SIZE_FIXED", label: "₱ by size", hint: "A fixed peso amount per car, set for each size." },
];
const peso = (n: number) => "₱" + n.toLocaleString("en-PH", { maximumFractionDigits: 2 });
// How the service pays its workers: one choice, then only the inputs that choice needs, with what each size earns beside it.
function CommissionField({ mode, onMode, rate, onRate, sizes, onSizes, prices }: {
  mode: CommissionMode; onMode: (m: CommissionMode) => void; rate: string; onRate: (v: string) => void;
  sizes: SizeValues; onSizes: (v: SizeValues) => void; prices: Record<string, number | null>;
}) {
  const perSize = PER_SIZE.includes(mode);
  const choose = (m: CommissionMode) => {
    onMode(m);
    if (m === "NONE") onRate("0");
    else if (m === "CUSTOM") onRate(rate && rate !== "0" ? rate : "10");
    else onRate("");
  };
  const earns = (size: string) => {
    const price = prices[size];
    const n = Number((mode === "CUSTOM" ? rate : sizes[size]) || "0");
    if (mode === "SIZE_FIXED") return price && n > 0 ? peso(n) : "—";
    return price && n > 0 ? peso(Math.round(price * n) / 100) : "—";
  };
  const box = "h-9 w-full rounded-md border border-border bg-card text-right text-sm tabular-nums text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30";
  return (
    <fieldset className="space-y-3">
      <legend className="text-xs font-semibold text-muted-foreground">Commission</legend>
      <div role="radiogroup" aria-label="How this service pays commission" className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-raised p-1 sm:grid-cols-5">
        {COMMISSION_CHOICES.map((c) => (
          <button
            key={c.mode}
            type="button"
            role="radio"
            aria-checked={mode === c.mode}
            onClick={() => choose(c.mode)}
            className={`min-h-[36px] rounded-md px-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              mode === c.mode ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{COMMISSION_CHOICES.find((c) => c.mode === mode)?.hint}</p>
      {mode === "CUSTOM" && (
        <label className="flex items-center justify-between gap-3 text-sm text-foreground">
          <span>Percentage</span>
          <span className="relative block w-24">
            <input
              type="text"
              inputMode="numeric"
              value={rate}
              placeholder="10"
              onChange={(e) => onRate(e.target.value.replace(/\D/g, "").slice(0, 3))}
              className={`${box} pl-2.5 pr-7`}
            />
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
          </span>
        </label>
      )}
      {(mode === "CUSTOM" || perSize) && (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-1.5 font-medium">Size</th>
                <th className="pb-1.5 text-right font-medium">Price</th>
                {perSize && <th className="pb-1.5 pl-3 text-right font-medium">{mode === "SIZE_FIXED" ? "Pesos" : "Percent"}</th>}
                <th className="pb-1.5 pl-3 text-right font-medium">Workers get</th>
              </tr>
            </thead>
            <tbody>
              {SIZE_ORDER.map((size) => (
                <tr key={size} className="border-t border-border">
                  <td className="py-1.5 text-foreground">{SIZE_LABEL[size]}</td>
                  <td className="py-1.5 text-right tabular-nums text-muted-foreground">{prices[size] ? peso(prices[size]!) : "Not offered"}</td>
                  {perSize && (
                    <td className="py-1.5 pl-3">
                      <span className="relative ml-auto block w-24">
                        {mode === "SIZE_FIXED" && <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₱</span>}
                        <input
                          type="text"
                          inputMode="numeric"
                          value={sizes[size] ?? "0"}
                          aria-label={`${SIZE_LABEL[size]} commission ${mode === "SIZE_FIXED" ? "pesos" : "percent"}`}
                          onChange={(e) => onSizes({ ...sizes, [size]: e.target.value.replace(/\D/g, "").slice(0, mode === "SIZE_FIXED" ? 7 : 3) })}
                          className={`${box} ${mode === "SIZE_FIXED" ? "pl-6 pr-2.5" : "pl-2.5 pr-7"}`}
                        />
                        {mode === "SIZE_PERCENT" && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>}
                      </span>
                    </td>
                  )}
                  <td className="py-1.5 pl-3 text-right font-semibold tabular-nums text-foreground">{earns(size)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground">Split equally between the workers on the booking.</p>
        </>
      )}
    </fieldset>
  );
}

export function ServicesTab({ role }: ServicesTabProps) {
  void role;
  const resource = useAdminResource<AdminServiceList>("/api/admin/services");
  const data = resource.data;
  const services = data?.services ?? [];

  const [selectedCategory, setSelectedCategory] = React.useState<string>("ALL");
  const [selectedStatus, setSelectedStatus] = React.useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL");
  const [searchQuery, setSearchQuery] = React.useState<string>("");

  // Pagination state
  const [currentPage, setCurrentPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(10);

  // Edit modal state
  const [editService, setEditService] = React.useState<AdminServiceItem | null>(null);
  const [editName, setEditName] = React.useState("");
  const [editDesc, setEditDesc] = React.useState("");
  const [editCategory, setEditCategory] = React.useState<CatalogServiceKind>("WASH");
  const [editOffers, setEditOffers] = React.useState<Record<string, {
    offered: boolean;
    regularPricePhp: string;
    hasPromo: boolean;
    promoPricePhp: string;
    pickupPricePhp?: string; // L and XL only
  }>>({});
  const [editCommissionMode, setEditCommissionMode] = React.useState<CommissionMode>("DEFAULT");
  const [editCommissionRate, setEditCommissionRate] = React.useState<string>("");
  const [editSizes, setEditSizes] = React.useState<SizeValues>({});
  const [editSaving, setEditSaving] = React.useState(false);
  const [editError, setEditError] = React.useState<string | null>(null);

  // Create modal state
  const [createOpen, setCreateOpen] = React.useState(false);
  const [createName, setCreateName] = React.useState("");
  const [createDesc, setCreateDesc] = React.useState("");
  const [createCategory, setCreateCategory] = React.useState<CatalogServiceKind>("WASH");
  const [createCommissionMode, setCreateCommissionMode] = React.useState<CommissionMode>("NONE");
  const [createCommissionRate, setCreateCommissionRate] = React.useState<string>("");
  const [createSizes, setCreateSizes] = React.useState<SizeValues>({});
  const [createType, setCreateType] = React.useState<"BASE" | "ADD_ON">("BASE");
  const [createUnit, setCreateUnit] = React.useState<PriceUnit>("VEHICLE");
  const [createOffers, setCreateOffers] = React.useState<Record<string, {
    offered: boolean;
    regularPricePhp: string;
    hasPromo: boolean;
    promoPricePhp: string;
    pickupPricePhp?: string; // L and XL only
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
    const commBp = svc.commissionRateBp;
    let mode: CommissionMode = "DEFAULT";
    let customVal = "";
    if (commBp === 0) {
      mode = "NONE";
      customVal = "0";
    } else if (commBp !== null && commBp !== undefined) {
      mode = "CUSTOM";
      customVal = String(Math.round(commBp / 100)); // whole percent only: an old 29.98 opens as 30
    }
    if (svc.commissionMode) mode = svc.commissionMode;
    setEditCommissionMode(mode);
    setEditCommissionRate(customVal);
    setEditSizes(Object.fromEntries((svc.sizeCommissions ?? []).map((c) => [c.sizeCode,
      String(svc.commissionMode === "SIZE_FIXED" ? Math.round((c.fixedCentavos ?? 0) / 100) : Math.round((c.rateBp ?? 0) / 100))])));
    const offerMap: Record<string, {
      offered: boolean;
      regularPricePhp: string;
      hasPromo: boolean;
      promoPricePhp: string;
      pickupPricePhp?: string;
    }> = {};
    for (const size of SIZE_ORDER) {
      const off = svc.offers.find((o) => o.sizeCode === size);
      const isOffered = off?.state !== "NOT_OFFERED";
      const unitPhp = off?.unitPriceCentavos ? (off.unitPriceCentavos / 100).toString() : "";
      const comparePhp = off?.compareAtCentavos ? (off.compareAtCentavos / 100).toString() : "";

      // If compareAtCentavos exists and is strictly greater than unitPriceCentavos,
      // there is an active discount/promo. CompareAt is the original Regular price,
      // and unitPrice is the discounted Promo price.
      // If there is NO discount, unitPrice is the standard Regular price.
      const hasActivePromo = Boolean(
        off?.compareAtCentavos &&
        off?.unitPriceCentavos &&
        off.compareAtCentavos > off.unitPriceCentavos
      );

      offerMap[size] = {
        offered: isOffered,
        regularPricePhp: hasActivePromo ? comparePhp : unitPhp,
        hasPromo: hasActivePromo,
        promoPricePhp: hasActivePromo ? unitPhp : "",
        pickupPricePhp: off?.pickupPriceCentavos ? (off.pickupPriceCentavos / 100).toString() : "",
      };
    }
    setEditOffers(offerMap);
    setEditError(null);
  };

  const initCreateModal = () => {
    setCreateName("");
    setCreateDesc("");
    setCreateCategory("WASH");
    setCreateCommissionMode("NONE"); // new services start with no commission (LE 2026-11-12)
    setCreateCommissionRate("0");
    setCreateSizes({});
    setCreateType("BASE");
    setCreateUnit("VEHICLE");
    const offerMap: Record<string, {
      offered: boolean;
      regularPricePhp: string;
      hasPromo: boolean;
      promoPricePhp: string;
      pickupPricePhp?: string;
    }> = {};
    for (const size of SIZE_ORDER) {
      offerMap[size] = {
        offered: true,
        regularPricePhp: "",
        hasPromo: false,
        promoPricePhp: "",
      };
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
      const row = editOffers[size] ?? {
        offered: true,
        regularPricePhp: "",
        hasPromo: false,
        promoPricePhp: "",
      };
      const regularNum = parseFloat(row.regularPricePhp || "0");
      const promoNum = parseFloat(row.promoPricePhp || "0");

      let unitPriceCentavos: number | null = null;
      let compareAtCentavos: number | null = null;

      if (row.offered && regularNum > 0) {
        if (row.hasPromo && promoNum > 0 && promoNum < regularNum) {
          // With active promo: selling price is promo price, compare-at is regular price
          unitPriceCentavos = Math.round(promoNum * 100);
          compareAtCentavos = Math.round(regularNum * 100);
        } else {
          // Standard regular pricing: selling price is regular price, no promo
          unitPriceCentavos = Math.round(regularNum * 100);
          compareAtCentavos = null;
        }
      }

      return {
        sizeCode: size,
        state: row.offered ? (regularNum > 0 ? "OFFERED" : "UNCONFIRMED") : "NOT_OFFERED",
        unitPriceCentavos,
        compareAtCentavos,
        pickupPriceCentavos: pickupCentavos(size, row),
      };
    });


    try {
      await adminRequest(`/api/admin/services/${editService.id}`, {
        method: "PATCH",
        body: {
          name: editName,
          description: editDesc || null,
          category: editCategory,
          ...commissionBody(editCommissionMode, editCommissionRate, editSizes),
          offers: offersPayload,
        },
      });
      setEditService(null);
      resource.reload();
    } catch (err) {
      const fieldErrors = (err && typeof err === "object" && "fieldErrors" in err) ? (err as AdminRequestError).fieldErrors : {};
      if (fieldErrors && Object.keys(fieldErrors).length > 0) {
        const detail = Object.entries(fieldErrors)
          .map(([f, msgs]) => `${f}: ${msgs.join(", ")}`)
          .join("; ");
        setEditError(detail ? `${err instanceof Error ? err.message : "Validation error"} (${detail})` : (err instanceof Error ? err.message : "Validation error"));
      } else {
        setEditError(err instanceof Error ? err.message : "Failed to update service");
      }
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
      const row = createOffers[size] ?? {
        offered: true,
        regularPricePhp: "",
        hasPromo: false,
        promoPricePhp: "",
      };
      const regularNum = parseFloat(row.regularPricePhp || "0");
      const promoNum = parseFloat(row.promoPricePhp || "0");

      let unitPriceCentavos: number | null = null;
      let compareAtCentavos: number | null = null;

      if (row.offered && regularNum > 0) {
        if (row.hasPromo && promoNum > 0 && promoNum < regularNum) {
          unitPriceCentavos = Math.round(promoNum * 100);
          compareAtCentavos = Math.round(regularNum * 100);
        } else {
          unitPriceCentavos = Math.round(regularNum * 100);
          compareAtCentavos = null;
        }
      }

      return {
        sizeCode: size,
        state: row.offered ? (regularNum > 0 ? "OFFERED" : "UNCONFIRMED") : "NOT_OFFERED",
        unitPriceCentavos,
        compareAtCentavos,
        pickupPriceCentavos: pickupCentavos(size, row),
      };
    });


    try {
      await adminRequest("/api/admin/services", {
        method: "POST",
        body: {
          name: createName,
          description: createDesc || null,
          category: createCategory,
          type: createType,
          unit: createUnit,
          ...commissionBody(createCommissionMode, createCommissionRate, createSizes),
          offers: offersPayload,
        },
      });
      setCreateOpen(false);
      resource.reload();
    } catch (err) {
      const fieldErrors = (err && typeof err === "object" && "fieldErrors" in err) ? (err as AdminRequestError).fieldErrors : {};
      if (fieldErrors && Object.keys(fieldErrors).length > 0) {
        const detail = Object.entries(fieldErrors)
          .map(([f, msgs]) => `${f}: ${msgs.join(", ")}`)
          .join("; ");
        setCreateError(detail ? `${err instanceof Error ? err.message : "Validation error"} (${detail})` : (err instanceof Error ? err.message : "Validation error"));
      } else {
        setCreateError(err instanceof Error ? err.message : "Failed to create service");
      }
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
    if (selectedStatus === "ACTIVE" && !s.isActive) return false;
    if (selectedStatus === "INACTIVE" && s.isActive) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return s.name.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q);
    }
    return true;
  });

  // Pagination calculations
  const totalPages = Math.max(1, Math.ceil(filteredServices.length / pageSize));
  const currentPageSafe = Math.min(currentPage, totalPages);
  const startIndex = (currentPageSafe - 1) * pageSize;
  const paginatedServices = filteredServices.slice(startIndex, startIndex + pageSize);

  const discountedCount = services.filter((s) =>
    s.offers.some((o) => o.compareAtCentavos && o.unitPriceCentavos && o.compareAtCentavos > o.unitPriceCentavos)
  ).length;

  return (
    <div className="space-y-6">
      {/* Header and Stats */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Service Catalog &amp; Pricing
          </h2>
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
        <div className="rounded border border-border bg-panel p-3.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total Services</p>
          <p className="mt-1 text-xl font-bold text-foreground">{services.length}</p>
        </div>
        <div className="rounded border border-border bg-panel p-3.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Active Online</p>
          <p className="mt-1 text-xl font-bold text-emerald-400">
            {services.filter((s) => s.isActive).length}
          </p>
        </div>
        <div className="rounded border border-border bg-panel p-3.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">On Promo / Discount</p>
          <p className="mt-1 text-xl font-bold text-amber-400">{discountedCount}</p>
        </div>
        <div className="rounded border border-border bg-panel p-3.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Categories</p>
          <p className="mt-1 text-xl font-bold text-foreground">{Object.keys(CATEGORY_LABELS).length}</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-panel p-4 lg:flex-row lg:items-center lg:justify-between shadow-sm">
        {/* Category Pills & Status Filter */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setSelectedCategory("ALL");
              setCurrentPage(1);
            }}
            className={`min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              selectedCategory === "ALL"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "border border-border text-muted-foreground hover:bg-raised hover:text-foreground"
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
                onClick={() => {
                  setSelectedCategory(cat);
                  setCurrentPage(1);
                }}
                className={`min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "border border-border text-muted-foreground hover:bg-raised hover:text-foreground"
                }`}
              >
                {CATEGORY_LABELS[cat]} ({count})
              </button>
            );
          })}

          <div className="flex items-center gap-1.5 rounded-lg border border-border bg-raised px-2.5 py-1.5 text-xs text-muted-foreground ml-1">
            <Filter className="h-3 w-3" />
            <span>Status:</span>
            <select
              value={selectedStatus}
              onChange={(e) => {
                setSelectedStatus(e.target.value as "ALL" | "ACTIVE" | "INACTIVE");
                setCurrentPage(1);
              }}
              className="bg-transparent text-xs text-foreground focus:outline-none"
            >
              <option value="ALL">All Status</option>
              <option value="ACTIVE">Active Online Only</option>
              <option value="INACTIVE">Hidden Only</option>
            </select>
          </div>
        </div>

        {/* Search Input */}
        <div className="relative min-w-[260px]">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            placeholder="Search service name or desc..."
            className="w-full rounded-lg border border-border bg-card py-2 pl-9 pr-8 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setCurrentPage(1);
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Services List */}
      {resource.loading && (
        <div className="flex h-48 items-center justify-center rounded border border-border bg-panel">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <span className="ml-2 text-xs text-muted-foreground">Loading service catalog...</span>
        </div>
      )}

      {!resource.loading && filteredServices.length === 0 && (
        <div className="flex h-48 flex-col items-center justify-center rounded border border-dashed border-border bg-panel p-8 text-center">
          <Tag className="h-8 w-8 text-muted-foreground/50" />
          <p className="mt-2 text-sm font-semibold text-foreground">No services found</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {searchQuery ? "Try refining your search filter." : "Get started by adding a service."}
          </p>
        </div>
      )}

      <div className="space-y-4">
        {paginatedServices.map((svc) => {
          const hasDiscount = svc.offers.some(
            (o) => o.compareAtCentavos && o.unitPriceCentavos && o.compareAtCentavos > o.unitPriceCentavos
          );
          return (
            <div
              key={svc.id}
              className={`rounded border border-border bg-panel p-4 transition-all hover:border-[#38383e] ${
                !svc.isActive ? "opacity-60" : ""
              }`}
            >
              {/* Card Header */}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-bold text-foreground">{svc.name}</h3>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-bold ${
                        CATEGORY_COLORS[svc.category] ?? "border-border text-muted-foreground"
                      }`}
                    >
                      {CATEGORY_LABELS[svc.category] ?? svc.category}
                    </span>
                    <span className="inline-flex items-center rounded border border-border/60 bg-card px-1.5 py-0.5 text-xs font-semibold text-muted-foreground">
                      {svc.type === "BASE" ? "Main Package" : "Add-on"}
                    </span>
                    {hasDiscount && (
                      <span className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-bold text-emerald-400">
                        <Percent className="h-3 w-3" />
                        Discount Active
                      </span>
                    )}
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${
                        svc.isActive
                          ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                          : "border border-zinc-700 bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${svc.isActive ? "bg-emerald-400" : "bg-zinc-400"}`} />
                      {svc.isActive ? "Active Online" : "Hidden"}
                    </span>
                    {svc.commissionMode ? (
                      <span className="inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2 py-0.5 text-xs font-bold">
                        <Percent className="h-2.5 w-2.5" />
                        {svc.commissionMode === "SIZE_FIXED" ? "₱ per size Comm." : "% per size Comm."}
                      </span>
                    ) : svc.commissionRateBp === 0 ? (
                      <span className="inline-flex items-center gap-1 rounded border border-stone-300 bg-stone-100 text-stone-700 dark:border-zinc-700 dark:bg-zinc-800/80 dark:text-zinc-400 px-2 py-0.5 text-xs font-bold">
                        <Ban className="h-2.5 w-2.5 text-stone-600 dark:text-zinc-400" />
                        No Comm.
                      </span>
                    ) : svc.commissionRateBp !== null && svc.commissionRateBp !== undefined ? (
                      <span className="inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2 py-0.5 text-xs font-bold">
                        <Percent className="h-2.5 w-2.5" />
                        {svc.commissionRateBp / 100}% Comm.
                      </span>
                    ) : svc.category === "WASH" ? (
                      <span className="inline-flex items-center gap-1 rounded border border-stone-200 bg-stone-100 text-stone-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-500 px-2 py-0.5 text-xs font-medium">
                        <Ban className="h-2.5 w-2.5 text-stone-500 dark:text-zinc-600" />
                        No Comm. (Default)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded border border-amber-500/20 bg-amber-500/5 px-2 py-0.5 text-xs font-bold text-amber-300/80">
                        <Percent className="h-2.5 w-2.5" />
                        Default Comm.
                      </span>
                    )}
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
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded border border-border bg-card px-3 py-1 text-xs font-semibold text-foreground hover:bg-raised hover:border-primary transition-colors"
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
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
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
                            ? "border-border/40 bg-panel opacity-50"
                            : isDiscounted
                            ? "border-emerald-500/30 bg-emerald-500/5"
                            : "border-border bg-card"
                        }`}
                      >
                        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          {SIZE_NAMES[size]}
                        </p>
                        <div className="mt-1">
                          {isOffered ? (
                            off.unitPriceCentavos !== null ? (
                              <div className="space-y-0.5">
                                {isDiscounted && (
                                  <div className="flex items-center justify-center gap-1.5">
                                    <span className="text-xs text-muted-foreground line-through">
                                      {formatCentavos(off.compareAtCentavos)}
                                    </span>
                                    <span className="rounded bg-emerald-500/20 px-1 py-0.2 text-xs font-black text-emerald-400">
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

      {/* Pagination Bar */}
      {filteredServices.length > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-panel p-4 sm:flex-row sm:items-center sm:justify-between text-xs text-muted-foreground shadow-sm">
          <div className="flex items-center gap-2">
            <span>
              Showing <strong className="text-foreground">{startIndex + 1}</strong> to{" "}
              <strong className="text-foreground">
                {Math.min(startIndex + pageSize, filteredServices.length)}
              </strong>{" "}
              of <strong className="text-foreground">{filteredServices.length}</strong> services
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

      {/* Edit Service & Pricing Modal */}
      {editService && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 overflow-y-auto bg-black/75 p-4 sm:p-6 grid place-items-center"
        >
          <div className="relative my-auto w-full max-w-2xl max-h-[calc(100vh-3rem)] flex flex-col rounded-xl border border-border bg-panel p-6 shadow-2xl space-y-5 overflow-y-auto">
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
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground">Service Name *</label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="mt-1 w-full rounded border border-border bg-card px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground">Category *</label>
                  <select
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value as CatalogServiceKind)}
                    className="mt-1 w-full rounded border border-border bg-card px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                  >
                    {(Object.keys(CATEGORY_LABELS) as CatalogServiceKind[]).map((cat) => (
                      <option key={cat} value={cat}>
                        {CATEGORY_LABELS[cat]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-full">
                  <CommissionField mode={editCommissionMode} onMode={setEditCommissionMode} rate={editCommissionRate} onRate={setEditCommissionRate}
                    sizes={editSizes} onSizes={setEditSizes} prices={sizePrices(editOffers)} />
                </div>
              </div>
              {editCategory === "GRAPHENE" && (
                <div className="rounded border border-purple-500/30 bg-purple-500/10 p-2.5 text-xs text-purple-300">
                  <span className="font-semibold">Coating Rule:</span> ₱1,500 chemical/product cost is automatically deducted from the base price before technician commission is calculated.
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-muted-foreground">Description</label>
                <textarea
                  rows={2}
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  placeholder="Included inclusions, warranty, description..."
                  className="mt-1 w-full rounded border border-border bg-card px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                />
              </div>

              {/* Pricing & Discounts per size */}
              <div className="space-y-3 border-t border-border pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-primary">
                      Pricing & Promo Discounts per Vehicle Size
                    </h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Enter regular price. Optionally enable promo/discount per vehicle size.
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-muted-foreground">Amounts in PHP (₱)</span>
                </div>

                <div className="space-y-2.5">
                  {SIZE_ORDER.map((size) => {
                    const cur = editOffers[size] ?? {
                      offered: true,
                      regularPricePhp: "",
                      hasPromo: false,
                      promoPricePhp: "",
                    };
                    const regular = parseFloat(cur.regularPricePhp || "0");
                    const promo = parseFloat(cur.promoPricePhp || "0");
                    const hasValidPromo = cur.hasPromo && promo > 0 && regular > 0 && promo < regular;
                    const discountPct = hasValidPromo ? Math.round(((regular - promo) / regular) * 100) : 0;
                    const savings = hasValidPromo ? regular - promo : 0;
                    const isPromoError = cur.hasPromo && promo > 0 && regular > 0 && promo >= regular;

                    return (
                      <div
                        key={size}
                        className={`rounded-lg border p-3.5 transition-colors ${
                          !cur.offered
                            ? "border-border/40 bg-panel opacity-60"
                            : cur.hasPromo && hasValidPromo
                            ? "border-emerald-500/40 bg-emerald-500/5 shadow-xs"
                            : "border-border bg-card"
                        }`}
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <label className="flex items-center gap-2 cursor-pointer min-w-[130px] select-none">
                            <input
                              type="checkbox"
                              checked={cur.offered}
                              onChange={(e) =>
                                setEditOffers((prev) => ({
                                  ...prev,
                                  [size]: { ...cur, offered: e.target.checked },
                                }))
                              }
                              className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                            />
                            <span className="text-xs font-bold text-foreground">{SIZE_NAMES[size]}</span>
                          </label>

                          {cur.offered ? (
                            <div className="flex flex-1 flex-wrap items-center gap-3.5 justify-end">
                              <div>
                                <label className="block text-xs font-bold text-foreground">
                                  Original / Regular Price (₱) *
                                </label>
                                <input
                                  type="number"
                                  step="any"
                                  min="0"
                                  placeholder="e.g. 500"
                                  value={cur.regularPricePhp}
                                  onChange={(e) =>
                                    setEditOffers((prev) => ({
                                      ...prev,
                                      [size]: { ...cur, regularPricePhp: e.target.value },
                                    }))
                                  }
                                  className="w-28 rounded border border-border bg-panel px-2.5 py-1.5 text-xs font-bold text-foreground focus:border-primary focus:outline-none"
                                />
                              </div>

                              {(size === "L" || size === "XL") && (
                                <div>
                                  <label className="block text-xs font-bold text-foreground">
                                    Pick-up price (₱)
                                  </label>
                                  <input
                                    type="number"
                                    step="any"
                                    min="0"
                                    placeholder="Same as above"
                                    aria-describedby="pickup-price-help"
                                    value={cur.pickupPricePhp ?? ""}
                                    onChange={(e) =>
                                      setEditOffers((prev) => ({
                                        ...prev,
                                        [size]: { ...cur, pickupPricePhp: e.target.value },
                                      }))
                                    }
                                    className="w-28 rounded border border-border bg-panel px-2.5 py-1.5 text-xs font-bold text-foreground focus:border-primary focus:outline-none"
                                  />
                                </div>
                              )}

                              <div className="flex flex-col justify-end">
                                <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground cursor-pointer select-none py-1">
                                  <input
                                    type="checkbox"
                                    checked={cur.hasPromo}
                                    onChange={(e) =>
                                      setEditOffers((prev) => ({
                                        ...prev,
                                        [size]: {
                                          ...cur,
                                          hasPromo: e.target.checked,
                                          promoPricePhp: e.target.checked ? cur.promoPricePhp : "",
                                        },
                                      }))
                                    }
                                    className="h-3.5 w-3.5 rounded border-border accent-emerald-500 cursor-pointer"
                                  />
                                  <Tag className="h-3 w-3 text-emerald-400" />
                                  <span>Promo / Discount</span>
                                </label>
                              </div>

                              {cur.hasPromo && (
                                <div className="flex items-center gap-2">
                                  <div>
                                    <label className="block text-xs font-bold text-emerald-400">
                                      Selling / Promo Price (₱) *
                                    </label>
                                    <input
                                      type="number"
                                      step="any"
                                      min="0"
                                      placeholder="e.g. 400"
                                      value={cur.promoPricePhp}
                                      onChange={(e) =>
                                        setEditOffers((prev) => ({
                                          ...prev,
                                          [size]: { ...cur, promoPricePhp: e.target.value },
                                        }))
                                      }
                                      className="w-28 rounded border border-emerald-500/50 bg-panel px-2.5 py-1.5 text-xs font-bold text-emerald-400 focus:border-emerald-400 focus:outline-none"
                                    />
                                  </div>

                                  {hasValidPromo && (
                                    <div className="self-end pb-1">
                                      <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 border border-emerald-500/30 px-2 py-1 text-xs font-black text-emerald-400">
                                        {discountPct}% OFF (Save ₱{savings})
                                      </span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs italic text-muted-foreground">Service not offered for this size</span>
                          )}
                        </div>

                        {cur.offered && isPromoError && (
                          <p className="mt-1.5 text-right text-xs font-semibold text-amber-400">
                            Promo price (₱{promo}) must be lower than regular price (₱{regular}) to apply a discount.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setEditService(null)}
                  className="rounded border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-card hover:text-foreground"
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
          className="fixed inset-0 z-50 overflow-y-auto bg-black/75 p-4 sm:p-6 grid place-items-center"
        >
          <div className="relative my-auto w-full max-w-2xl max-h-[calc(100vh-3rem)] flex flex-col rounded-xl border border-border bg-panel p-6 shadow-2xl space-y-5 overflow-y-auto">
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
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground">Service Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Engine Bay Detail"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    className="mt-1 w-full rounded border border-border bg-card px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground">Category *</label>
                  <select
                    value={createCategory}
                    onChange={(e) => setCreateCategory(e.target.value as CatalogServiceKind)}
                    className="mt-1 w-full rounded border border-border bg-card px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                  >
                    {(Object.keys(CATEGORY_LABELS) as CatalogServiceKind[]).map((cat) => (
                      <option key={cat} value={cat}>
                        {CATEGORY_LABELS[cat]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-full">
                  <CommissionField mode={createCommissionMode} onMode={setCreateCommissionMode} rate={createCommissionRate} onRate={setCreateCommissionRate}
                    sizes={createSizes} onSizes={setCreateSizes} prices={sizePrices(createOffers)} />
                </div>
              </div>
              {createCategory === "GRAPHENE" && (
                <div className="rounded border border-purple-500/30 bg-purple-500/10 p-2.5 text-xs text-purple-300">
                  <span className="font-semibold">Coating Rule:</span> ₱1,500 chemical/product cost is automatically deducted from the base price before technician commission is calculated.
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground">Service Type</label>
                  <select
                    value={createType}
                    onChange={(e) => setCreateType(e.target.value as "BASE" | "ADD_ON")}
                    className="mt-1 w-full rounded border border-border bg-card px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
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
                    className="mt-1 w-full rounded border border-border bg-card px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
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
                  className="mt-1 w-full rounded border border-border bg-card px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
                />
              </div>

              {/* Pricing & Discounts per size */}
              <div className="space-y-3 border-t border-border pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-primary">
                      Initial Pricing & Promo Discounts per Vehicle Size
                    </h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Enter regular price. Optionally enable promo/discount per vehicle size.
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-muted-foreground">Amounts in PHP (₱)</span>
                </div>

                <div className="space-y-2.5">
                  {SIZE_ORDER.map((size) => {
                    const cur = createOffers[size] ?? {
                      offered: true,
                      regularPricePhp: "",
                      hasPromo: false,
                      promoPricePhp: "",
                    };
                    const regular = parseFloat(cur.regularPricePhp || "0");
                    const promo = parseFloat(cur.promoPricePhp || "0");
                    const hasValidPromo = cur.hasPromo && promo > 0 && regular > 0 && promo < regular;
                    const discountPct = hasValidPromo ? Math.round(((regular - promo) / regular) * 100) : 0;
                    const savings = hasValidPromo ? regular - promo : 0;
                    const isPromoError = cur.hasPromo && promo > 0 && regular > 0 && promo >= regular;

                    return (
                      <div
                        key={size}
                        className={`rounded-lg border p-3.5 transition-colors ${
                          !cur.offered
                            ? "border-border/40 bg-panel opacity-60"
                            : cur.hasPromo && hasValidPromo
                            ? "border-emerald-500/40 bg-emerald-500/5 shadow-xs"
                            : "border-border bg-card"
                        }`}
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <label className="flex items-center gap-2 cursor-pointer min-w-[130px] select-none">
                            <input
                              type="checkbox"
                              checked={cur.offered}
                              onChange={(e) =>
                                setCreateOffers((prev) => ({
                                  ...prev,
                                  [size]: { ...cur, offered: e.target.checked },
                                }))
                              }
                              className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                            />
                            <span className="text-xs font-bold text-foreground">{SIZE_NAMES[size]}</span>
                          </label>

                          {cur.offered ? (
                            <div className="flex flex-1 flex-wrap items-center gap-3.5 justify-end">
                              <div>
                                <label className="block text-xs font-bold text-foreground">
                                  Original / Regular Price (₱) *
                                </label>
                                <input
                                  type="number"
                                  step="any"
                                  min="0"
                                  placeholder="e.g. 500"
                                  value={cur.regularPricePhp}
                                  onChange={(e) =>
                                    setCreateOffers((prev) => ({
                                      ...prev,
                                      [size]: { ...cur, regularPricePhp: e.target.value },
                                    }))
                                  }
                                  className="w-28 rounded border border-border bg-panel px-2.5 py-1.5 text-xs font-bold text-foreground focus:border-primary focus:outline-none"
                                />
                              </div>

                              {(size === "L" || size === "XL") && (
                                <div>
                                  <label className="block text-xs font-bold text-foreground">
                                    Pick-up price (₱)
                                  </label>
                                  <input
                                    type="number"
                                    step="any"
                                    min="0"
                                    placeholder="Same as above"
                                    aria-describedby="pickup-price-help"
                                    value={cur.pickupPricePhp ?? ""}
                                    onChange={(e) =>
                                      setCreateOffers((prev) => ({
                                        ...prev,
                                        [size]: { ...cur, pickupPricePhp: e.target.value },
                                      }))
                                    }
                                    className="w-28 rounded border border-border bg-panel px-2.5 py-1.5 text-xs font-bold text-foreground focus:border-primary focus:outline-none"
                                  />
                                </div>
                              )}

                              <div className="flex flex-col justify-end">
                                <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground cursor-pointer select-none py-1">
                                  <input
                                    type="checkbox"
                                    checked={cur.hasPromo}
                                    onChange={(e) =>
                                      setCreateOffers((prev) => ({
                                        ...prev,
                                        [size]: {
                                          ...cur,
                                          hasPromo: e.target.checked,
                                          promoPricePhp: e.target.checked ? cur.promoPricePhp : "",
                                        },
                                      }))
                                    }
                                    className="h-3.5 w-3.5 rounded border-border accent-emerald-500 cursor-pointer"
                                  />
                                  <Tag className="h-3 w-3 text-emerald-400" />
                                  <span>Promo / Discount</span>
                                </label>
                              </div>

                              {cur.hasPromo && (
                                <div className="flex items-center gap-2">
                                  <div>
                                    <label className="block text-xs font-bold text-emerald-400">
                                      Selling / Promo Price (₱) *
                                    </label>
                                    <input
                                      type="number"
                                      step="any"
                                      min="0"
                                      placeholder="e.g. 400"
                                      value={cur.promoPricePhp}
                                      onChange={(e) =>
                                        setCreateOffers((prev) => ({
                                          ...prev,
                                          [size]: { ...cur, promoPricePhp: e.target.value },
                                        }))
                                      }
                                      className="w-28 rounded border border-emerald-500/50 bg-panel px-2.5 py-1.5 text-xs font-bold text-emerald-400 focus:border-emerald-400 focus:outline-none"
                                    />
                                  </div>

                                  {hasValidPromo && (
                                    <div className="self-end pb-1">
                                      <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 border border-emerald-500/30 px-2 py-1 text-xs font-black text-emerald-400">
                                        {discountPct}% OFF (Save ₱{savings})
                                      </span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs italic text-muted-foreground">Not offered for this size</span>
                          )}
                        </div>

                        {cur.offered && isPromoError && (
                          <p className="mt-1.5 text-right text-xs font-semibold text-amber-400">
                            Promo price (₱{promo}) must be lower than regular price (₱{regular}) to apply a discount.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="rounded border border-border px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-card hover:text-foreground"
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
