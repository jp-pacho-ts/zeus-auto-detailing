"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  Bike,
  CalendarDays,
  Car,
  CarFront,
  Check,
  ChevronLeft,
  Copy,
  Droplets,
  MessageSquare,
  Phone,
  Printer,
  ShieldCheck,
  Sparkles,
  Sun,
  Sunset,
  Truck,
  Wind,
  X,
} from "lucide-react";
import { brandConfig } from "@/config/brand";
import { formatDuration } from "@/config/catalog";
import { Logo } from "@/components/ui/logo";
import { CreateBookingSchema } from "@/lib/validation";
import { createBookingAction } from "@/server/actions/booking";
import type {
  AvailableSlotData,
  AvailableSlotResponse,
  BookingCatalog,
  BookingCatalogResponse,
  BookingSummary,
  CreateBookingRequest,
} from "@/types/contracts";

function getVehicleCategoryIcon(codeOrName: string) {
  const lower = codeOrName.toLowerCase();
  if (lower.includes("motorcycle") || lower.includes("bike") || lower === "motorcycle_specialty") return Bike;
  if (lower.includes("pickup") || lower.includes("van") || lower === "pickup_van" || lower.includes("truck")) return Truck;
  if (lower.includes("suv") || lower.includes("crossover") || lower === "suv_crossover") return CarFront;
  return Car;
}

function getServiceDisciplineIcon(categoryOrName: string) {
  const lower = categoryOrName.toLowerCase();
  if (lower.includes("interior") || lower.includes("cabin") || lower.includes("leather") || lower === "interior_detailing") return Wind;
  if (lower.includes("wash") || lower.includes("seal") || lower.includes("water") || lower.includes("clean") || lower === "exterior_wash_seal") return Droplets;
  if (lower.includes("correction") || lower.includes("polish") || lower.includes("scratch") || lower === "paint_correction") return Sparkles;
  return ShieldCheck;
}

const todayInManila = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const money = (centavos: number) =>
  new Intl.NumberFormat(brandConfig.locale, { style: "currency", currency: "PHP" }).format(centavos / 100);
const dateLabel = (date: string) =>
  new Intl.DateTimeFormat(brandConfig.locale, { dateStyle: "full", timeZone: "Asia/Manila" }).format(
    new Date(date + "T00:00:00+08:00"),
  );
const timeLabel = (time: string) =>
  new Intl.DateTimeFormat(brandConfig.locale, { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(
    new Date("2000-01-01T" + time + ":00+08:00"),
  );

const control =
  "mt-2 min-h-[48px] w-full rounded border border-input bg-card px-4 py-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 transition-colors";
const panel = "rounded border border-border bg-card p-6 sm:p-8";
const vehicleCodes: Record<string, string> = {
  sedan: "SEDAN",
  suv: "SUV_CROSSOVER",
  pickup: "PICKUP_VAN",
  motorcycle: "MOTORCYCLE_SPECIALTY",
};
const serviceAliases: Record<string, string> = {
  "signature-9h-graphene": "signature-ceramic-coating",
};

function formatPhilippinePhone(raw: string): string {
  if (!raw) return "";
  if (raw.startsWith("+")) {
    const digits = raw.slice(1).replace(/\D/g, "").slice(0, 12);
    if (!digits) return "+";
    if (digits.startsWith("63")) {
      const rest = digits.slice(2);
      if (!rest) return "+63";
      if (rest.length <= 3) return `+63 ${rest}`;
      if (rest.length <= 6) return `+63 ${rest.slice(0, 3)} ${rest.slice(3)}`;
      return `+63 ${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6)}`;
    }
    return `+${digits}`;
  }
  const digits = raw.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 4) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 4)} ${digits.slice(4)}`;
  return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
}

export function BookingWizard({
  initialServiceId,
  initialVehicleName,
}: {
  initialServiceId?: string;
  initialVehicleName?: string;
}) {
  const [step, setStep] = React.useState(1);
  const [catalog, setCatalog] = React.useState<BookingCatalog | null>(null);
  const [catalogError, setCatalogError] = React.useState("");
  const [catalogVersion, setCatalogVersion] = React.useState(0);
  const [vehicleId, setVehicleId] = React.useState("");
  const [serviceId, setServiceId] = React.useState("");
  const [linkWarning, setLinkWarning] = React.useState("");
  const [copied, setCopied] = React.useState(false);
  const [date, setDate] = React.useState(todayInManila);
  const [selection, setSelection] = React.useState<{ key: string; time: string } | null>(null);
  const [availability, setAvailability] = React.useState<{
    key: string;
    data: AvailableSlotData | null;
    error: string;
  } | null>(null);
  const [availabilityVersion, setAvailabilityVersion] = React.useState(0);
  const [form, setForm] = React.useState({
    customerName: "",
    customerPhone: "",
    customerEmail: "",
    vehicleModel: "",
    vehiclePlate: "",
    specialRequests: "",
  });
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [message, setMessage] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [uncertain, setUncertain] = React.useState(false);
  const [booking, setBooking] = React.useState<BookingSummary | null>(null);

  const submitting = React.useRef(false);
  const attempt = React.useRef<CreateBookingRequest | null>(null);
  const errorSummary = React.useRef<HTMLDivElement>(null);
  const deepLinkHandled = React.useRef(false);

  const copyReference = () => {
    if (booking?.referenceCode && typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(booking.referenceCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const key = date + "|" + vehicleId + "|" + serviceId;
  const vehicle = catalog?.vehicleCategories.find((v) => v.id === vehicleId);
  const service = catalog?.services.find((s) => s.id === serviceId);
  const live = availability?.key === key ? availability : null;
  const slot =
    selection?.key === key
      ? live?.data?.slots.find((s) => s.startTime === selection.time && s.selectable)
      : undefined;
  const maxDate = new Date(new Date(todayInManila() + "T00:00:00Z").getTime() + 90 * 86400000)
    .toISOString()
    .slice(0, 10);

  const currentTotal =
    live?.data?.totalPriceCentavos ??
    Math.round((service?.basePriceCentavos ?? 0) * (vehicle?.sizeMultiplier ?? 1));
  const currentDuration = live?.data?.durationMinutes ?? service?.durationMinutes ?? 0;

  // Inline validation checks for Step 4
  const isPhoneValid = /^(09\d{9}|\+639\d{9})$/.test(form.customerPhone.replace(/[\s()\-]/g, ""));
  const isNameValid = form.customerName.trim().length >= 2;
  const isModelValid = form.vehicleModel.trim().length >= 2;

  React.useEffect(() => {
    const controller = new AbortController();
    fetch("/api/catalog", { cache: "no-store", signal: controller.signal })
      .then((response) => response.json())
      .then((result: BookingCatalogResponse) => {
        if (controller.signal.aborted) return;
        if (!result.ok) throw new Error(result.error.message);
        if (!result.data.vehicleCategories.length || !result.data.services.length) {
          throw new Error("The shop has no bookable services yet. Please contact the shop hotline.");
        }
        const data = result.data;
        setCatalog(data);
        setCatalogError("");

        const hasVehicleParam = Boolean(initialVehicleName?.trim());
        const hasServiceParam = Boolean(initialServiceId?.trim());

        const vQuery = initialVehicleName?.toLowerCase().trim() ?? "";
        const matchedVehicle = vQuery
          ? data.vehicleCategories.find(
              (v) =>
                v.id.toLowerCase() === vQuery ||
                v.code.toLowerCase() === vQuery ||
                v.code === vehicleCodes[vQuery] ||
                v.name.toLowerCase() === vQuery ||
                v.name.toLowerCase().split("/")[0].trim() === vQuery,
            )
          : undefined;

        const sQuery = initialServiceId?.toLowerCase().trim() ?? "";
        const matchedService = sQuery
          ? data.services.find(
              (s) =>
                s.id.toLowerCase() === sQuery ||
                s.slug.toLowerCase() === sQuery ||
                s.slug === (serviceAliases[sQuery] ?? sQuery) ||
                s.name.toLowerCase() === sQuery,
            )
          : undefined;

        if (hasVehicleParam || hasServiceParam) {
          if (matchedVehicle && matchedService) {
            setVehicleId(matchedVehicle.id);
            setServiceId(matchedService.id);
            setLinkWarning("");
            if (!deepLinkHandled.current) {
              deepLinkHandled.current = true;
              setStep(3);
            }
          } else {
            // Invalid or incomplete parameters: stay on Step 1, do NOT assign fallback index
            setVehicleId("");
            setServiceId("");
            setStep(1);
            setLinkWarning(
              "The linked service or vehicle could not be found. Please choose from our available detailing services.",
            );
          }
        } else {
          // No parameters provided
          setVehicleId((previous) =>
            data.vehicleCategories.some((v) => v.id === previous) ? previous : "",
          );
          setServiceId((previous) =>
            data.services.some((s) => s.id === previous) ? previous : "",
          );
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setCatalogError(error instanceof Error ? error.message : "The service menu is unavailable. Please retry.");
        }
      });
    return () => controller.abort();
  }, [initialServiceId, initialVehicleName, catalogVersion]);

  React.useEffect(() => {
    if (!vehicleId || !serviceId || (step !== 3 && step !== 4) || uncertain) return;
    let controller: AbortController | null = null;
    let active = true;
    const refresh = async () => {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      try {
        const query = new URLSearchParams({ date, vehicleCategoryId: vehicleId, serviceId });
        const response = await fetch("/api/availability?" + query, {
          cache: "no-store",
          signal: request.signal,
        });
        const result: AvailableSlotResponse = await response.json();
        if (!active || request.signal.aborted) return;
        if (!result.ok) {
          setAvailability({ key, data: null, error: result.error.message });
          return;
        }
        setAvailability({ key, data: result.data, error: "" });
        setSelection((previous) =>
          previous?.key === key &&
          !result.data.slots.some((s) => s.startTime === previous.time && s.selectable)
            ? null
            : previous,
        );
      } catch {
        if (active && !request.signal.aborted) {
          setAvailability({
            key,
            data: null,
            error: "Could not refresh availability. Check your connection and retry.",
          });
        }
      }
    };
    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 15000);
    const focus = () => {
      void refresh();
    };
    window.addEventListener("focus", focus);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", focus);
    };
  }, [date, vehicleId, serviceId, step, key, availabilityVersion, uncertain]);

  React.useEffect(() => {
    if (message) errorSummary.current?.focus();
  }, [message, fieldErrors]);

  const next = async () => {
    if (submitting.current) return;
    setMessage("");
    setFieldErrors({});
    if (step === 1 && vehicle) {
      setStep(2);
      return;
    }
    if (step === 2 && service) {
      setStep(3);
      return;
    }
    if (step === 3) {
      if (slot) setStep(4);
      else setMessage("Choose an available arrival time.");
      return;
    }
    if (step !== 4) return;
    if (!attempt.current) {
      if (!slot) {
        setStep(3);
        setMessage("Availability has changed. Please select an arrival time again.");
        return;
      }
      const cleanPhone = form.customerPhone.replace(/[\s()\-]/g, "");
      const normalizedPhone = /^9\d{9}$/.test(cleanPhone) ? "+63" + cleanPhone : cleanPhone;
      const parsed = CreateBookingSchema.safeParse({
        ...form,
        customerPhone: normalizedPhone,
        vehicleCategoryId: vehicleId,
        serviceId,
        bookingDate: date,
        startTime: slot.startTime,
        idempotencyKey: crypto.randomUUID(),
      });
      if (!parsed.success) {
        const errors: Record<string, string[]> = {};
        for (const issue of parsed.error.issues) {
          (errors[issue.path.join(".") || "form"] ??= []).push(issue.message);
        }
        setFieldErrors(errors);
        setMessage("Please check the highlighted details.");
        return;
      }
      attempt.current = parsed.data;
    }
    submitting.current = true;
    setPending(true);
    try {
      const result = await createBookingAction(attempt.current);
      if (result.ok) {
        setBooking(result.data);
        setStep(5);
        setUncertain(false);
        attempt.current = null;
      } else {
        setFieldErrors(result.error.fieldErrors);
        setMessage(result.error.message);
        setUncertain(result.error.retryable);
        if (!result.error.retryable) attempt.current = null;
        if (result.error.code === "SLOT_UNAVAILABLE" || result.error.code === "SCHEDULE_CONFLICT") {
          setSelection(null);
          setStep(3);
          setMessage(
            "The selected arrival slot is no longer available. Please select another time session. Your customer and vehicle details have been saved.",
          );
          setAvailabilityVersion((v) => v + 1);
        }
        if (result.error.code === "NOT_FOUND") {
          setStep(result.error.fieldErrors.vehicleCategoryId ? 1 : 2);
          setCatalogVersion((v) => v + 1);
        }
      }
    } catch {
      setUncertain(true);
      setMessage(
        "The result could not be confirmed. Retry this same submission to recover your booking safely.",
      );
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };

  const retryCatalog = () => {
    setCatalogError("");
    setCatalogVersion((v) => v + 1);
  };
  const locked = pending || uncertain;
  const errorFor = (field: string) => fieldErrors[field]?.join(" ");
  const STEP_LABELS = [
    "Vehicle",
    "Service",
    "Date & Time",
    "Details & Review",
    "Booking Received",
  ];
  const headings = [
    "Choose Vehicle Classification",
    "Select Detailing Service",
    "Select Appointment Date & Time",
    "Details & Review",
    "Booking Received",
  ];

  // Group slots into Morning (08:00–12:00) and Afternoon (12:00–18:00) blocks (Hick's Law)
  const morningSlots = live?.data?.slots.filter((s) => s.startTime < "12:00") ?? [];
  const afternoonSlots = live?.data?.slots.filter((s) => s.startTime >= "12:00") ?? [];

  const renderSlot = (s: AvailableSlotData["slots"][number]) => {
    const isSelected = selection?.key === key && selection.time === s.startTime;
    return (
      <label
        key={s.slotId}
        className={`flex min-h-[64px] items-center justify-between gap-3 rounded border px-4 py-3 transition-colors ${
          !s.selectable
            ? "cursor-not-allowed border-border opacity-50 bg-[#121214]/60"
            : isSelected
            ? "border-primary bg-primary/10 shadow-sm"
            : "cursor-pointer border-input bg-card hover:border-zinc-500"
        }`}
      >
        <div>
          <span className="block font-semibold text-foreground">{timeLabel(s.startTime)}</span>
          <span className="block text-xs text-muted-foreground">
            {s.selectable
              ? s.remainingCapacity === 1
                ? "1 Bay Left"
                : `${s.remainingCapacity} Bays Open`
              : s.state === "SOLD_OUT"
              ? "Sold Out"
              : s.reason}
          </span>
        </div>
        <input
          type="radio"
          name="arrival-time"
          aria-label={`${timeLabel(s.startTime)} — ${s.selectable ? `${s.remainingCapacity} bays available` : s.reason}`}
          checked={isSelected}
          disabled={!s.selectable}
          onChange={() => setSelection({ key, time: s.startTime })}
          className="h-5 w-5 shrink-0 accent-primary"
        />
      </label>
    );
  };

  // Persistent Reservation Summary Sidebar (Recognition over Recall)
  const renderSummarySidebar = () => (
    <aside aria-label="Reservation Summary" className="hidden lg:col-span-4 lg:block">
      <div className="sticky top-6 rounded border border-border bg-[#121214] p-6 shadow-sm">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-primary">
            Reservation Summary
          </h2>
          <span className="rounded bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
            Dedicated Bay
          </span>
        </div>

        <dl className="mt-4 space-y-4 text-sm">
          <div>
            <div className="flex items-center justify-between">
              <dt className="text-xs font-medium text-muted-foreground">Vehicle Classification</dt>
              <button
                type="button"
                onClick={() => {
                  setStep(1);
                  setMessage("");
                }}
                className="inline-flex min-h-[44px] items-center text-xs font-semibold text-primary hover:underline"
              >
                Change
              </button>
            </div>
            <dd className="font-bold text-foreground">{vehicle?.name ?? "—"}</dd>
            <p className="text-xs text-zinc-400">{vehicle?.sizeMultiplier ?? 1.0}× surface scale</p>
          </div>

          <div className="border-t border-border/60 pt-3">
            <div className="flex items-center justify-between">
              <dt className="text-xs font-medium text-muted-foreground">Detailing Service</dt>
              {step > 2 && (
                <button
                  type="button"
                  onClick={() => {
                    setStep(2);
                    setMessage("");
                  }}
                  className="inline-flex min-h-[44px] items-center text-xs font-semibold text-primary hover:underline"
                >
                  Change
                </button>
              )}
            </div>
            <dd className="font-bold text-foreground">
              {service?.name ?? "Selecting service…"}
            </dd>
            <p className="text-xs text-zinc-400">
              {formatDuration(currentDuration)} estimated service duration
            </p>
          </div>

          {step >= 3 && (
            <div className="border-t border-border/60 pt-3">
              <div className="flex items-center justify-between">
                <dt className="text-xs font-medium text-muted-foreground">Appointment Schedule</dt>
                {step > 3 && (
                  <button
                    type="button"
                    onClick={() => {
                      setStep(3);
                      setMessage("");
                    }}
                    className="inline-flex min-h-[44px] items-center text-xs font-semibold text-primary hover:underline"
                  >
                    Change
                  </button>
                )}
              </div>
              <dd className="font-bold text-foreground">
                {date ? dateLabel(date) : "Select date"}
              </dd>
              <p className="text-xs text-zinc-400">
                {slot
                  ? `${timeLabel(slot.startTime)} – ${timeLabel(slot.endTime)}`
                  : "Select arrival slot in Step 3"}
              </p>
            </div>
          )}

          <div className="border-t border-border pt-4">
            <dt className="text-xs font-medium text-muted-foreground">Estimated Investment</dt>
            <dd className="mt-1 text-2xl font-extrabold tabular-nums tracking-tight text-foreground">
              {money(currentTotal)}
            </dd>
            <p className="mt-1 text-xs text-zinc-400">
              Taxes, professional consumables & shop service included.
            </p>
          </div>
        </dl>
      </div>
    </aside>
  );

  // Mobile persistent summary tray for Steps 2-4
  const renderMobileSummaryTray = () => (
    <div className="mb-6 rounded border border-border bg-[#121214] p-4 text-sm lg:hidden">
      <div className="flex items-start justify-between gap-3 border-b border-border/60 pb-3">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-primary">
            Current Reservation
          </span>
          <p className="font-bold text-foreground">
            {service?.name || "Selecting service…"}
          </p>
          <p className="text-xs text-muted-foreground">
            {vehicle?.name} · {formatDuration(currentDuration)}
          </p>
        </div>
        <div className="text-right shrink-0">
          <span className="text-base font-extrabold tabular-nums text-foreground">
            {money(currentTotal)}
          </span>
          {slot && (
            <p className="text-[11px] font-medium text-primary">
              {timeLabel(slot.startTime)}
            </p>
          )}
        </div>
      </div>
      <div className="mt-2.5 flex items-center justify-between text-xs">
        <span className="text-zinc-400">
          {step === 2
            ? "Select detailing service"
            : step === 3
            ? slot
              ? `${dateLabel(date)} · ${timeLabel(slot.startTime)}`
              : "Select arrival slot below"
            : `${dateLabel(date)} · ${slot ? timeLabel(slot.startTime) : ""}`}
        </span>
        <button
          type="button"
          onClick={() => {
            setStep(1);
            setMessage("");
          }}
          className="inline-flex min-h-[44px] items-center px-1 font-semibold text-primary hover:underline"
        >
          Change setup
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <style>{`
        @media print {
          header,
          .no-print,
          .wizard-footer {
            display: none !important;
          }
          body, main {
            background: #ffffff !important;
            color: #000000 !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          .print-receipt-card {
            border: 1px solid #000000 !important;
            background: #ffffff !important;
            color: #000000 !important;
            box-shadow: none !important;
            padding: 16px !important;
          }
          .print-receipt-card * {
            color: #000000 !important;
            border-color: #cccccc !important;
          }
        }
      `}</style>
      <header className="border-b border-border bg-card no-print">
        <div className="mx-auto flex h-20 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link
            href="/"
            aria-label="Return to home"
            className="inline-flex min-h-[44px] items-center"
          >
            <Logo />
          </Link>
          <span className="text-sm text-muted-foreground">{STEP_LABELS[step - 1]} · Step {step} of 5</span>
          {!locked && (
            <Link
              href="/"
              aria-label="Cancel and return to home"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center"
            >
              <X aria-hidden="true" className="h-5 w-5" />
            </Link>
          )}
        </div>
        <div className="h-1 bg-border">
          <div
            className="h-full bg-primary motion-safe:transition-all"
            style={{ width: step * 20 + "%" }}
          />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="mb-8 max-w-3xl">
          <h1 className="text-2xl font-bold sm:text-3xl">{headings[step - 1]}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Appointment times are shown in Asia/Manila (UTC+8). Dedicated service time is allocated for your vehicle.
          </p>
        </div>

        {message && (
          <div
            ref={errorSummary}
            tabIndex={-1}
            role="alert"
            className="mb-6 rounded border border-destructive p-4 text-sm text-destructive"
          >
            <p className="font-semibold">{message}</p>
            {Object.entries(fieldErrors).map(([field, errors]) => (
              <p key={field} className="mt-1">
                <a
                  className="inline-flex min-h-[44px] items-center underline"
                  href={step === 4 ? "#" + field : "#arrival-date"}
                >
                  {errors.join(" ")}
                </a>
              </p>
            ))}
          </div>
        )}

        {!catalog && !catalogError && (
          <div role="status" className={panel}>
            Loading the shop service menu…
          </div>
        )}
        {catalogError && (
          <div role="alert" className={panel}>
            <p>{catalogError}</p>
            <button
              type="button"
              onClick={retryCatalog}
              className="mt-4 min-h-[44px] underline"
            >
              Retry service menu
            </button>
          </div>
        )}

        {/* Step 1: Vehicle Selection (Full Width) */}
        {catalog && step === 1 && (
          <div className="max-w-3xl">
            {linkWarning && (
              <div
                role="alert"
                className="mb-6 flex items-start justify-between gap-3 rounded border border-warning/50 bg-warning/10 p-4 text-sm text-warning"
              >
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <p>{linkWarning}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setLinkWarning("")}
                  aria-label="Dismiss warning"
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center -mr-2 -mt-2 text-warning hover:opacity-80"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            )}
            <fieldset className="space-y-3">
              <legend className="mb-3 text-sm text-muted-foreground">
                Choose one vehicle category to calibrate service duration and pricing.
              </legend>
              {catalog.vehicleCategories.map((v) => {
                const VehicleIcon = getVehicleCategoryIcon(v.code || v.name);
                return (
                  <label
                    key={v.id}
                    className={
                      panel +
                      " flex min-h-[80px] cursor-pointer items-center justify-between gap-4 transition-colors " +
                      (vehicleId === v.id ? "border-primary bg-primary/5" : "hover:border-zinc-500")
                    }
                  >
                    <div className="flex items-start gap-3.5">
                      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded border border-border bg-[#18181b]">
                        <VehicleIcon className="h-5 w-5 text-primary shrink-0" aria-hidden="true" />
                      </div>
                      <div>
                        <span className="block font-bold text-foreground">{v.name}</span>
                        <span className="text-sm text-muted-foreground">{v.description}</span>
                        <span className="mt-1.5 block text-xs font-semibold text-primary">
                          {v.sizeMultiplier}× service pricing scale
                        </span>
                      </div>
                    </div>
                    <input
                      type="radio"
                      name="vehicle-category"
                      value={v.id}
                      checked={vehicleId === v.id}
                      onChange={() => {
                        setVehicleId(v.id);
                        setSelection(null);
                        setLinkWarning("");
                      }}
                      className="h-5 w-5 accent-primary shrink-0"
                    />
                  </label>
                );
              })}
            </fieldset>
          </div>
        )}

        {/* Steps 2, 3, 4: Multi-Column Layout with Persistent Summary Tray */}
        {catalog && step >= 2 && step <= 4 && (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
            <div className="lg:col-span-8">
              {renderMobileSummaryTray()}

              {/* Step 2: Treatment Selection */}
              {step === 2 && (
                <fieldset className="space-y-3">
                  <legend className="mb-3 text-sm text-muted-foreground">
                    Choose one active detailing service for your {vehicle?.name}.
                  </legend>
                  {catalog.services.map((s) => {
                    const TreatmentIcon = getServiceDisciplineIcon(s.category || s.name);
                    return (
                      <label
                        key={s.id}
                        className={
                          panel +
                          " flex min-h-[110px] cursor-pointer items-center justify-between gap-4 transition-colors " +
                          (serviceId === s.id ? "border-primary bg-primary/5" : "hover:border-zinc-500")
                        }
                      >
                        <div className="flex items-start gap-3.5">
                          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded border border-border bg-[#18181b]">
                            <TreatmentIcon className="h-5 w-5 text-primary shrink-0" aria-hidden="true" />
                          </div>
                          <div>
                            <span className="block font-bold text-foreground">{s.name}</span>
                            <span className="mt-1 block text-sm text-muted-foreground">
                              {s.description}
                            </span>
                            <span className="mt-3 block text-sm font-semibold text-foreground">
                              {formatDuration(s.durationMinutes)} ·{" "}
                              {money(Math.round(s.basePriceCentavos * (vehicle?.sizeMultiplier ?? 1)))}
                            </span>
                          </div>
                        </div>
                        <input
                          type="radio"
                          name="service"
                          value={s.id}
                          checked={serviceId === s.id}
                          onChange={() => {
                            setServiceId(s.id);
                            setSelection(null);
                          }}
                          className="h-5 w-5 shrink-0 accent-primary"
                        />
                      </label>
                    );
                  })}
                </fieldset>
              )}

              {/* Step 3: Date & Slot Picker (Grouped by Morning & Afternoon) */}
              {step === 3 && (
                <div className="space-y-6">
                  <div className={panel}>
                    <label htmlFor="arrival-date" className="block text-sm font-semibold text-foreground">
                      Arrival date
                    </label>
                    <input
                      id="arrival-date"
                      type="date"
                      min={todayInManila()}
                      max={maxDate}
                      value={date}
                      onChange={(e) => {
                        setDate(e.target.value);
                        setSelection(null);
                      }}
                      className={control}
                    />
                    <p className="mt-2 text-xs text-muted-foreground">
                      Choose today through the next 90 days. Operating hours and bay availability are checked in real-time.
                    </p>
                  </div>

                  <section
                    aria-labelledby="slots-title"
                    aria-busy={!live}
                    className={panel}
                  >
                    <div className="flex items-baseline justify-between border-b border-border pb-3">
                      <div>
                        <h2 id="slots-title" className="text-lg font-bold text-foreground">
                          Available arrival sessions
                        </h2>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {date ? dateLabel(date) : "Choose a date"}
                        </p>
                      </div>
                      <span className="rounded bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                        {brandConfig.defaultBays} Detailing Bays
                      </span>
                    </div>

                    {!live && (
                      <div role="status" className="mt-6 grid grid-cols-2 gap-3">
                        <span className="sr-only">Loading bay availability</span>
                        {[0, 1, 2, 3].map((i) => (
                          <div
                            key={i}
                            className="h-16 rounded bg-muted motion-safe:animate-pulse"
                          />
                        ))}
                      </div>
                    )}

                    {live?.error && (
                      <div role="alert" className="mt-4">
                        <p className="text-sm text-destructive">{live.error}</p>
                        <button
                          type="button"
                          onClick={() => setAvailabilityVersion((v) => v + 1)}
                          className="mt-2 min-h-[44px] text-xs underline"
                        >
                          Retry availability
                        </button>
                      </div>
                    )}

                    {live?.data && (
                      <>
                        <p
                          role="status"
                          aria-live="polite"
                          className="my-3 text-xs text-zinc-400"
                        >
                          {live.data.reason ||
                            (live.data.slots.some((s) => s.selectable)
                              ? "Live availability calculated for the full service duration."
                              : "No arrival sessions remain for this service on this date.")}
                        </p>

                        {!live.data.slots.some((s) => s.selectable) && (
                          <div className="my-4 rounded border border-border/80 bg-[#121214] p-4 text-sm">
                            <p className="text-zinc-400">
                              All arrival sessions are booked or unavailable for {date ? dateLabel(date) : "this date"}.
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                const nextDay = new Date(new Date(date + "T00:00:00+08:00").getTime() + 86400000)
                                  .toISOString()
                                  .slice(0, 10);
                                if (nextDay <= maxDate) {
                                  setDate(nextDay);
                                  setSelection(null);
                                }
                              }}
                              className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded border border-primary/40 bg-primary/10 px-4 py-2 text-xs font-bold text-primary hover:bg-primary/20"
                            >
                              <CalendarDays className="h-4 w-4" aria-hidden="true" />
                              Check Next Available Date
                            </button>
                          </div>
                        )}

                        {/* Morning Sessions (08:00 - 12:00) */}
                        {morningSlots.length > 0 && (
                          <div className="mt-4">
                            <div className="mb-2 flex items-center justify-between border-b border-border/80 pb-1.5">
                              <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary">
                                <Sun className="h-4 w-4 shrink-0" aria-hidden="true" /> Morning Sessions (08:00 AM – 12:00 PM)
                              </h3>
                              <span className="text-xs text-zinc-400">
                                {morningSlots.filter((s) => s.selectable).length} open
                              </span>
                            </div>
                            <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                              <legend className="sr-only">Morning arrival slots</legend>
                              {morningSlots.map(renderSlot)}
                            </fieldset>
                          </div>
                        )}

                        {/* Afternoon Sessions (12:00 - 18:00) */}
                        {afternoonSlots.length > 0 && (
                          <div className="mt-6">
                            <div className="mb-2 flex items-center justify-between border-b border-border/80 pb-1.5">
                              <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary">
                                <Sunset className="h-4 w-4 shrink-0" aria-hidden="true" /> Afternoon Sessions (12:00 PM – 06:00 PM)
                              </h3>
                              <span className="text-xs text-zinc-400">
                                {afternoonSlots.filter((s) => s.selectable).length} open
                              </span>
                            </div>
                            <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                              <legend className="sr-only">Afternoon arrival slots</legend>
                              {afternoonSlots.map(renderSlot)}
                            </fieldset>
                          </div>
                        )}

                        <div className="mt-4 flex items-start gap-2.5 rounded border border-border/60 bg-[#121214] p-3 text-xs text-zinc-400">
                          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                          <p>
                            <strong className="text-foreground">Bay Reservation Notice:</strong> Selecting an arrival time does not hold the slot. Bay availability is secured when your booking request is submitted.
                          </p>
                        </div>

                        <p className="mt-4 text-xs text-zinc-400">
                          {formatDuration(live.data.durationMinutes)} full bay allocation · Estimated quote{" "}
                          <span className="font-semibold text-foreground">
                            {money(live.data.totalPriceCentavos)}
                          </span>
                          .
                        </p>
                      </>
                    )}
                  </section>
                </div>
              )}

              {/* Step 4: Customer Details Form */}
              {step === 4 && (
                <form
                  id="booking-details"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void next();
                  }}
                  className={panel}
                >
                  {/* Explicit Pre-Submission Review Panel */}
                  <div className="mb-6 rounded border border-border bg-[#121214] p-5">
                    <div className="flex items-center justify-between border-b border-border pb-3">
                      <h2 className="text-sm font-bold uppercase tracking-wider text-primary">
                        Pre-Submission Review
                      </h2>
                      <span className="rounded bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                        Step 4 of 5
                      </span>
                    </div>

                    <div className="mt-3 divide-y divide-border/60 text-sm">
                      {/* Vehicle */}
                      <div className="flex items-start justify-between py-3">
                        <div>
                          <span className="block text-xs font-medium text-muted-foreground">Vehicle Classification</span>
                          <span className="font-bold text-foreground">{vehicle?.name ?? "—"}</span>
                          <p className="text-xs text-zinc-400">
                            {vehicle?.sizeMultiplier ?? 1.0}× vehicle size adjustment
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setStep(1);
                            setMessage("");
                          }}
                          className="inline-flex min-h-[44px] items-center px-2 text-xs font-semibold text-primary hover:underline"
                          aria-label="Edit vehicle classification"
                        >
                          Edit
                        </button>
                      </div>

                      {/* Service */}
                      <div className="flex items-start justify-between py-3">
                        <div>
                          <span className="block text-xs font-medium text-muted-foreground">Detailing Service</span>
                          <span className="font-bold text-foreground">{service?.name ?? "—"}</span>
                          <p className="text-xs text-zinc-400">
                            {service?.category ? service.category.replace(/_/g, " ") : "Specialized Detailing"}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setStep(2);
                            setMessage("");
                          }}
                          className="inline-flex min-h-[44px] items-center px-2 text-xs font-semibold text-primary hover:underline"
                          aria-label="Edit detailing service"
                        >
                          Edit
                        </button>
                      </div>

                      {/* Schedule */}
                      <div className="flex items-start justify-between py-3">
                        <div>
                          <span className="block text-xs font-medium text-muted-foreground">Appointment Schedule</span>
                          <span className="font-bold text-foreground">
                            {dateLabel(date)} · {slot ? `${timeLabel(slot.startTime)} – ${timeLabel(slot.endTime)}` : "Select arrival slot"}
                          </span>
                          <p className="text-xs text-zinc-400">Timezone: Asia/Manila (UTC+8)</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setStep(3);
                            setMessage("");
                          }}
                          className="inline-flex min-h-[44px] items-center px-2 text-xs font-semibold text-primary hover:underline"
                          aria-label="Edit appointment schedule"
                        >
                          Edit
                        </button>
                      </div>

                      {/* Duration */}
                      <div className="flex items-start justify-between py-3">
                        <div>
                          <span className="block text-xs font-medium text-muted-foreground">Estimated Service Duration</span>
                          <span className="font-bold text-foreground">{formatDuration(currentDuration)}</span>
                          <p className="text-xs text-zinc-400">
                            Estimated shop allocation (intake walkaround to release)
                          </p>
                        </div>
                      </div>

                      {/* Estimated Investment */}
                      <div className="pt-3">
                        <div className="flex items-baseline justify-between">
                          <span className="text-xs font-medium text-muted-foreground">Estimated Investment</span>
                          <span className="text-2xl font-extrabold tabular-nums tracking-tight text-foreground">
                            {money(currentTotal)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-zinc-400">
                          Taxes, professional consumables & shop service included.
                        </p>
                      </div>
                    </div>
                  </div>

                  {uncertain && (
                    <p className="mb-6 rounded border border-warning/50 bg-warning/10 p-3 text-sm text-warning">
                      Your submitted details are held unchanged while the confirmation is uncertain. Retry to safely recover your reservation.
                    </p>
                  )}

                  <fieldset disabled={locked} className="space-y-5">
                    <legend className="sr-only">Customer and vehicle details</legend>

                    {/* Customer Name */}
                    <div>
                      <div className="flex items-center justify-between">
                        <label htmlFor="customerName" className="text-sm font-semibold text-foreground">
                          Full customer name
                        </label>
                        {isNameValid && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                            <Check className="h-3.5 w-3.5" /> Valid
                          </span>
                        )}
                      </div>
                      <input
                        id="customerName"
                        name="customerName"
                        type="text"
                        autoComplete="name"
                        enterKeyHint="next"
                        maxLength={100}
                        value={form.customerName}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, customerName: e.target.value }))
                        }
                        placeholder="e.g. Juan dela Cruz"
                        aria-invalid={Boolean(errorFor("customerName"))}
                        aria-describedby={errorFor("customerName") ? "customerName-error" : undefined}
                        className={`${control} ${errorFor("customerName") ? "border-destructive ring-1 ring-destructive" : ""}`}
                      />
                      {errorFor("customerName") && (
                        <p id="customerName-error" className="mt-1.5 text-xs text-destructive">
                          {errorFor("customerName")}
                        </p>
                      )}
                    </div>

                    {/* Customer Phone (with auto-formatting, tel inputmode, inline validation) */}
                    <div>
                      <div className="flex items-center justify-between">
                        <label htmlFor="customerPhone" className="text-sm font-semibold text-foreground">
                          Philippine mobile number
                        </label>
                        {isPhoneValid && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                            <Check className="h-3.5 w-3.5" /> Valid number
                          </span>
                        )}
                      </div>
                      <input
                        id="customerPhone"
                        name="customerPhone"
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        enterKeyHint="next"
                        maxLength={32}
                        value={form.customerPhone}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            customerPhone: formatPhilippinePhone(e.target.value),
                          }))
                        }
                        placeholder="0930 016 2234"
                        aria-invalid={Boolean(errorFor("customerPhone"))}
                        aria-describedby={
                          errorFor("customerPhone") ? "customerPhone-error" : "customerPhone-help"
                        }
                        className={`${control} ${errorFor("customerPhone") ? "border-destructive ring-1 ring-destructive" : ""}`}
                      />
                      <p id="customerPhone-help" className="mt-1.5 text-xs text-zinc-400">
                        Format: 09XX XXX XXXX or +63 9XX XXX XXXX for shop contact and appointment updates.
                      </p>
                      {errorFor("customerPhone") && (
                        <p id="customerPhone-error" className="mt-1 text-xs text-destructive">
                          {errorFor("customerPhone")}
                        </p>
                      )}
                    </div>

                    {/* Customer Email */}
                    <div>
                      <label htmlFor="customerEmail" className="text-sm font-semibold text-foreground">
                        Email address <span className="text-xs font-normal text-muted-foreground">(optional)</span>
                      </label>
                      <input
                        id="customerEmail"
                        name="customerEmail"
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        enterKeyHint="next"
                        maxLength={254}
                        value={form.customerEmail}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, customerEmail: e.target.value }))
                        }
                        placeholder="juan@example.ph"
                        aria-invalid={Boolean(errorFor("customerEmail"))}
                        aria-describedby={errorFor("customerEmail") ? "customerEmail-error" : undefined}
                        className={`${control} ${errorFor("customerEmail") ? "border-destructive ring-1 ring-destructive" : ""}`}
                      />
                      {errorFor("customerEmail") && (
                        <p id="customerEmail-error" className="mt-1.5 text-xs text-destructive">
                          {errorFor("customerEmail")}
                        </p>
                      )}
                    </div>

                    {/* Vehicle Model */}
                    <div>
                      <div className="flex items-center justify-between">
                        <label htmlFor="vehicleModel" className="text-sm font-semibold text-foreground">
                          Vehicle make, model and year
                        </label>
                        {isModelValid && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                            <Check className="h-3.5 w-3.5" /> Provided
                          </span>
                        )}
                      </div>
                      <input
                        id="vehicleModel"
                        name="vehicleModel"
                        type="text"
                        autoComplete="off"
                        enterKeyHint="next"
                        maxLength={100}
                        value={form.vehicleModel}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, vehicleModel: e.target.value }))
                        }
                        placeholder="e.g. 2024 Toyota Fortuner GR-S"
                        aria-invalid={Boolean(errorFor("vehicleModel"))}
                        aria-describedby={errorFor("vehicleModel") ? "vehicleModel-error" : undefined}
                        className={`${control} ${errorFor("vehicleModel") ? "border-destructive ring-1 ring-destructive" : ""}`}
                      />
                      {errorFor("vehicleModel") && (
                        <p id="vehicleModel-error" className="mt-1.5 text-xs text-destructive">
                          {errorFor("vehicleModel")}
                        </p>
                      )}
                    </div>

                    {/* Vehicle Plate */}
                    <div>
                      <label htmlFor="vehiclePlate" className="text-sm font-semibold text-foreground">
                        Plate or conduction number <span className="text-xs font-normal text-muted-foreground">(optional)</span>
                      </label>
                      <input
                        id="vehiclePlate"
                        name="vehiclePlate"
                        type="text"
                        autoComplete="off"
                        enterKeyHint="next"
                        maxLength={20}
                        value={form.vehiclePlate}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, vehiclePlate: e.target.value }))
                        }
                        placeholder="e.g. ABC 1234 or Conduction 0821"
                        aria-invalid={Boolean(errorFor("vehiclePlate"))}
                        aria-describedby={errorFor("vehiclePlate") ? "vehiclePlate-error" : undefined}
                        className={`${control} ${errorFor("vehiclePlate") ? "border-destructive ring-1 ring-destructive" : ""}`}
                      />
                      {errorFor("vehiclePlate") && (
                        <p id="vehiclePlate-error" className="mt-1.5 text-xs text-destructive">
                          {errorFor("vehiclePlate")}
                        </p>
                      )}
                    </div>

                    {/* Special Requests */}
                    <div>
                      <label htmlFor="specialRequests" className="text-sm font-semibold text-foreground">
                        Special requests or paint history <span className="text-xs font-normal text-muted-foreground">(optional)</span>
                      </label>
                      <textarea
                        id="specialRequests"
                        name="specialRequests"
                        rows={3}
                        maxLength={1000}
                        enterKeyHint="done"
                        value={form.specialRequests}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, specialRequests: e.target.value }))
                        }
                        placeholder="Specific scratches, previous ceramic coating brand, interior stains, or arrival preferences…"
                        aria-invalid={Boolean(errorFor("specialRequests"))}
                        aria-describedby={errorFor("specialRequests") ? "specialRequests-error" : undefined}
                        className={control}
                      />
                      {errorFor("specialRequests") && (
                        <p id="specialRequests-error" className="mt-1.5 text-xs text-destructive">
                          {errorFor("specialRequests")}
                        </p>
                      )}
                    </div>
                  </fieldset>
                </form>
              )}
            </div>

            {/* Sticky Summary Tray (Desktop) */}
            {renderSummarySidebar()}
          </div>
        )}

        {/* Step 5: Booking Confirmation Voucher */}
        {step === 5 && booking && (
          <div className="max-w-3xl space-y-6">
            <section
              aria-labelledby="reference-title"
              className={`${panel} print-receipt-card`}
            >
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
                <div className="flex items-center gap-3">
                  <ShieldCheck aria-hidden="true" className="h-8 w-8 text-primary shrink-0" />
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                      {booking.status === "CONFIRMED" ? "Booking Confirmed" : "Booking Received"}
                    </p>
                    <h2
                      id="reference-title"
                      className="text-2xl font-extrabold tabular-nums tracking-tight text-foreground sm:text-3xl"
                    >
                      {booking.referenceCode}
                    </h2>
                  </div>
                </div>

                {/* Actions: Copy Reference & Print Receipt */}
                <div className="flex items-center gap-2 no-print">
                  <button
                    type="button"
                    onClick={copyReference}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded border border-border bg-card px-3.5 py-2 text-xs font-semibold text-foreground transition-colors hover:border-zinc-500 hover:text-primary"
                    aria-label="Copy booking reference code"
                  >
                    {copied ? (
                      <>
                        <Check className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                        <span className="text-emerald-400">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4" aria-hidden="true" />
                        <span>Copy Reference</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (typeof window !== "undefined") window.print();
                    }}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded border border-border bg-card px-3.5 py-2 text-xs font-semibold text-foreground transition-colors hover:border-zinc-500 hover:text-primary"
                    aria-label="Print booking receipt"
                  >
                    <Printer className="h-4 w-4" aria-hidden="true" />
                    <span>Print Receipt</span>
                  </button>
                </div>
              </div>

              <p className="mt-4 text-sm text-muted-foreground">
                {booking.status === "CONFIRMED"
                  ? "Your appointment is confirmed. Please arrive on time for your scheduled intake walkaround."
                  : "We have received your appointment request. Our shop team will review your booking request and contact you to confirm your slot."}
              </p>

              <dl className="mt-6 divide-y divide-border/60 text-sm">
                <div className="py-3">
                  <dt className="text-xs text-muted-foreground">Appointment Date & Arrival Time</dt>
                  <dd className="mt-0.5 font-bold text-foreground">
                    {dateLabel(booking.bookingDate)} · {timeLabel(booking.startTime)}–{timeLabel(booking.endTime)} · {booking.timezone}
                  </dd>
                </div>
                <div className="py-3">
                  <dt className="text-xs text-muted-foreground">Detailing Service</dt>
                  <dd className="mt-0.5 text-foreground">
                    <span className="font-semibold">{booking.serviceName}</span>
                  </dd>
                </div>
                <div className="py-3">
                  <dt className="text-xs text-muted-foreground">Estimated Service Duration</dt>
                  <dd className="mt-0.5 text-foreground">
                    {formatDuration(booking.durationMinutes)}{" "}
                    <span className="text-xs text-zinc-400">
                      (Estimated duration only — not a guaranteed vehicle release time. Final inspection depends on surface condition.)
                    </span>
                  </dd>
                </div>
                <div className="py-3">
                  <dt className="text-xs text-muted-foreground">Vehicle</dt>
                  <dd className="mt-0.5 text-foreground">
                    {booking.vehicleCategoryName} · {booking.vehicleModel}
                    {booking.vehiclePlate ? ` (${booking.vehiclePlate})` : ""}
                  </dd>
                </div>
                <div className="py-3">
                  <dt className="text-xs text-muted-foreground">Customer Contact</dt>
                  <dd className="mt-0.5 text-foreground">
                    {booking.customerName} · {booking.customerPhone}
                  </dd>
                </div>
                <div className="py-3">
                  <dt className="text-xs text-muted-foreground">Estimated Investment</dt>
                  <dd className="mt-1 text-2xl font-extrabold tabular-nums text-foreground">
                    {money(booking.totalPriceCentavos)}
                  </dd>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    Includes labor, professional coatings/compounds, and shop supplies.
                  </p>
                </div>
                <div className="py-3">
                  <dt className="text-xs text-muted-foreground">Shop Location</dt>
                  <dd className="mt-0.5 font-medium text-foreground">{brandConfig.address}</dd>
                </div>
                <div className="py-3">
                  <dt className="text-xs text-muted-foreground">Operating Schedule</dt>
                  <dd className="mt-0.5 font-medium text-foreground">{brandConfig.operatingHours}</dd>
                </div>
                <div className="py-3">
                  <dt className="text-xs text-muted-foreground">Shop Hotline</dt>
                  <dd className="mt-0.5">
                    <a
                      href={`tel:${brandConfig.contactPhone.replace(/\s+/g, "")}`}
                      className="inline-flex min-h-[44px] items-center font-semibold text-primary hover:underline"
                      aria-label={`Call shop hotline at ${brandConfig.displayPhone}`}
                    >
                      {brandConfig.displayPhone} ({brandConfig.contactPhone})
                    </a>
                  </dd>
                </div>
              </dl>

              <div className="mt-6 rounded border border-border/80 bg-[#121214] p-4 text-xs text-zinc-400">
                <p>
                  <strong className="text-foreground">Next Steps:</strong> Your booking is currently <span className="font-semibold text-primary">PENDING</span> shop confirmation. Our shop team will review your booking request and contact you to confirm your slot. Please save or print this voucher for your arrival walkaround.
                </p>
              </div>
            </section>

            {/* Post-Booking Assistance: Contact Shop Card */}
            <div className={`${panel} no-print`}>
              <h3 className="text-base font-bold text-foreground">
                Contact Shop About This Booking
              </h3>
              <p className="mt-1 text-xs text-zinc-400">
                Have questions or need to modify your arrival time? Reach out directly to Zeus Auto Detailing with reference code <span className="font-mono font-semibold text-primary">{booking.referenceCode}</span>.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <a
                  href={`tel:${brandConfig.contactPhone.replace(/\s+/g, "")}`}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded border border-border bg-card px-4 py-2.5 text-xs font-bold text-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  <Phone className="h-4 w-4 text-primary" aria-hidden="true" />
                  Call Shop Hotline ({brandConfig.displayPhone})
                </a>
                <a
                  href={`https://m.me/zeusautodetailingtacloban?text=${encodeURIComponent(`Hi, I have a booking inquiry for reference code ${booking.referenceCode}.`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[44px] items-center gap-2 rounded border border-border bg-card px-4 py-2.5 text-xs font-bold text-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  <MessageSquare className="h-4 w-4 text-primary" aria-hidden="true" />
                  Message on Facebook Messenger
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Wizard Footer Controls */}
        <div className="mt-8 no-print wizard-footer">
          <div className="flex max-w-5xl items-center justify-between gap-4">
            {step > 1 && step < 5 ? (
              <button
                type="button"
                disabled={locked}
                onClick={() => {
                  setStep((s) => s - 1);
                  setMessage("");
                  setFieldErrors({});
                }}
                className="inline-flex min-h-[44px] items-center gap-2 px-4 font-semibold text-foreground transition-colors hover:text-primary disabled:opacity-50"
              >
                <ChevronLeft aria-hidden="true" className="h-4 w-4" />
                Back
              </button>
            ) : (
              <span />
            )}

            {step < 5 ? (
              <button
                type={step === 4 ? "submit" : "button"}
                form={step === 4 ? "booking-details" : undefined}
                onClick={(event) => {
                  if (step !== 4) {
                    event.preventDefault();
                    void next();
                  }
                }}
                disabled={
                  pending ||
                  !catalog ||
                  Boolean(catalogError) ||
                  (step === 1 && !vehicleId) ||
                  (step === 2 && !serviceId) ||
                  (step === 3 && !slot)
                }
                className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded bg-primary px-6 py-3 font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending
                  ? "Saving reservation…"
                  : step === 4
                  ? uncertain
                    ? "Retry same submission"
                    : "Submit booking request"
                  : "Continue"}
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </button>
            ) : (
              <Link
                href="/"
                className="inline-flex min-h-[48px] items-center gap-2 rounded bg-primary px-6 py-3 font-bold text-primary-foreground transition-colors hover:bg-primary-hover"
              >
                Return to Home
                <Check aria-hidden="true" className="h-4 w-4" />
              </Link>
            )}
          </div>
          {step === 4 && (
            <p className="mt-3 text-right text-xs text-zinc-400">
              Submitting creates a PENDING booking request. Our shop will review bay capacity and contact you to confirm your appointment.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
