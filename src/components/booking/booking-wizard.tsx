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
  Truck,
  Wind,
  X,
} from "lucide-react";
import { brandConfig } from "@/config/brand";
import { Logo } from "@/components/ui/logo";
import { TurnstileChallenge } from "@/components/booking/turnstile";
import {
  availableAddOns,
  createDayRequest,
  dayStateLabel,
  isMultiDay,
  money,
  offerLabel,
  publicCreateError,
  quoteTotal,
  resolveDeepLink,
  selectionLines,
  type DetailsForm,
  type ServicePick,
} from "@/components/booking/day-booking";
import type {
  BookingCatalog,
  BookingCatalogResponse,
  BookingQuote,
  BookingQuoteResponse,
  ServicePackage,
} from "@/types/catalog-contracts";
import type {
  CreateDayBookingRequest,
  DayAvailabilityData,
  DayAvailabilityResponse,
  DayBookingResponse,
  DayBookingView,
} from "@/types/contracts";

function getVehicleCategoryIcon(code: string) {
  if (code === "MOTOR") return Bike;
  if (code === "L" || code === "XL") return Truck;
  if (code === "M") return CarFront;
  return Car;
}

function getServiceDisciplineIcon(category: string) {
  if (category === "WASH") return Droplets;
  if (category === "DETAILING") return Wind;
  if (category === "GRAPHENE" || category === "REPAINT") return Sparkles;
  return ShieldCheck;
}

const DAYS_PER_PAGE = 14;
const todayInManila = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const addDays = (day: string, n: number) =>
  new Date(new Date(day + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);
const dateLabel = (date: string) =>
  new Intl.DateTimeFormat(brandConfig.locale, { dateStyle: "full", timeZone: "Asia/Manila" }).format(
    new Date(date + "T00:00:00+08:00"),
  );
const shortDayLabel = (date: string) =>
  new Intl.DateTimeFormat(brandConfig.locale, { weekday: "short", month: "short", day: "numeric", timeZone: "Asia/Manila" }).format(
    new Date(date + "T00:00:00+08:00"),
  );
const linesQuery = (lines: ServicePick[]) => lines.map((l) => l.serviceId + ":" + l.quantity).join(",");
const BOOKING_HEADERS = { "content-type": "application/json", "x-zeus-booking": "1" };
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

const control =
  "mt-2 min-h-[48px] w-full rounded border border-input bg-card px-4 py-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 transition-colors";
const panel = "rounded border border-border bg-card p-6 sm:p-8";

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

// A priced line reads as its price; a for-quote line as "For quote", with its estimate if any.
const lineAmount = (l: { priceStatus: "PRICED" | "FOR_QUOTE"; subtotalCentavos: number | null; referenceSubtotalCentavos: number | null }) =>
  l.priceStatus === "PRICED" && l.subtotalCentavos !== null
    ? money(l.subtotalCentavos)
    : l.referenceSubtotalCentavos === null
      ? "For quote"
      : "For quote · est. " + money(l.referenceSubtotalCentavos);

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
  const [picks, setPicks] = React.useState<ServicePick[]>([]);
  const [linkWarning, setLinkWarning] = React.useState("");
  const [copied, setCopied] = React.useState(false);
  const [fromDate, setFromDate] = React.useState(todayInManila);
  const [day, setDay] = React.useState("");
  const [quoteState, setQuoteState] = React.useState<{ key: string; quote: BookingQuote | null; error: string } | null>(null);
  const [quoteVersion, setQuoteVersion] = React.useState(0);
  const [days, setDays] = React.useState<{ key: string; data: DayAvailabilityData | null; error: string } | null>(null);
  const [daysVersion, setDaysVersion] = React.useState(0);
  const [form, setForm] = React.useState<DetailsForm>({
    customerName: "",
    customerPhone: "",
    customerEmail: "",
    vehicleModel: "",
    vehiclePlate: "",
    specialRequests: "",
  });
  const [challenge, setChallenge] = React.useState({ version: 0, token: "" });
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [message, setMessage] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [uncertain, setUncertain] = React.useState(false);
  const [booking, setBooking] = React.useState<{ view: DayBookingView; vehicleModel: string; vehiclePlate: string | null; customerName: string; customerPhone: string; multiDay: boolean } | null>(null);

  const submitting = React.useRef(false);
  const attempt = React.useRef<CreateDayBookingRequest | null>(null);
  const errorSummary = React.useRef<HTMLDivElement>(null);
  const deepLinkHandled = React.useRef(false);

  const copyReference = () => {
    if (!booking || typeof navigator === "undefined" || !navigator.clipboard) return;
    navigator.clipboard.writeText(booking.view.referenceCode).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => setCopied(false),
    );
  };

  const vehicle = catalog?.vehicleCategories.find((v) => v.id === vehicleId);
  const lines = React.useMemo(
    () => (catalog && vehicleId ? selectionLines(catalog, vehicleId, picks) : []),
    [catalog, vehicleId, picks],
  );
  const selectionKey = vehicleId + "|" + linesQuery(lines);
  const daysKey = selectionKey + "|" + fromDate;
  const liveDays = days?.key === daysKey ? days : null;
  const lastDay = addDays(todayInManila(), 90);
  // The newest signed quote for this selection: the day list carries a fresh one too.
  const quote: BookingQuote | null =
    (liveDays?.data?.quote && quoteState?.key === selectionKey && quoteState.quote
      ? Date.parse(liveDays.data.quote.issuedAt) >= Date.parse(quoteState.quote.issuedAt)
        ? liveDays.data.quote
        : quoteState.quote
      : liveDays?.data?.quote ?? (quoteState?.key === selectionKey ? quoteState.quote : null)) ?? null;
  const total = quote ? quoteTotal(quote) : null;
  const dayState = liveDays?.data?.days.find((d) => d.date === day)?.state;
  const multiDay = catalog ? isMultiDay(catalog, lines.map((l) => l.serviceId)) : false;
  const serviceById = (id: string) => catalog?.services.find((s) => s.id === id);
  const bases = catalog?.services.filter((s) => s.type === "BASE") ?? [];
  const addOns = catalog ? availableAddOns(catalog, lines.map((l) => l.serviceId)) : [];
  const picked = (id: string) => picks.find((p) => p.serviceId === id);

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
        // Apply the booking link only on the first catalog load so later catalog refreshes
        // never override choices the customer has made since.
        if (!deepLinkHandled.current) {
          deepLinkHandled.current = true;
          const link = resolveDeepLink(data, initialVehicleName, initialServiceId);
          if (link.unknown) {
            setLinkWarning(
              "The linked service or vehicle could not be found. Please choose from our available detailing services.",
            );
          } else {
            if (link.vehicleId) setVehicleId(link.vehicleId);
            if (link.serviceId) setPicks([{ serviceId: link.serviceId, quantity: 1 }]);
            if (link.vehicleId) setStep(2);
          }
        } else {
          setVehicleId((previous) => (data.vehicleCategories.some((v) => v.id === previous) ? previous : ""));
          setPicks((previous) => previous.filter((p) => data.services.some((s) => s.id === p.serviceId)));
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setCatalogError(error instanceof Error ? error.message : "The service menu is unavailable. Please retry.");
        }
      });
    return () => controller.abort();
  }, [initialServiceId, initialVehicleName, catalogVersion]);

  // The server prices the selection (and signs it) as soon as it changes.
  React.useEffect(() => {
    if (!vehicleId || !lines.length || step < 2 || step > 4 || uncertain) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const query = new URLSearchParams({ vehicleCategoryId: vehicleId, lines: linesQuery(lines) });
        const response = await fetch("/api/bookings/quote?" + query, { cache: "no-store", signal: controller.signal });
        const result: BookingQuoteResponse = await response.json();
        if (controller.signal.aborted) return;
        setQuoteState(
          result.ok
            ? { key: selectionKey, quote: result.data.quote, error: "" }
            : { key: selectionKey, quote: null, error: result.error.message },
        );
      } catch {
        if (!controller.signal.aborted)
          setQuoteState({ key: selectionKey, quote: null, error: "Could not price these services. Check your connection and retry." });
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [vehicleId, lines, selectionKey, step, quoteVersion, uncertain]);

  // Day states for the selection's queue; refreshed while choosing and reviewing.
  React.useEffect(() => {
    if (!vehicleId || !lines.length || (step !== 3 && step !== 4) || uncertain) return;
    let controller: AbortController | null = null;
    let active = true;
    const refresh = async () => {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      try {
        const query = new URLSearchParams({ vehicleCategoryId: vehicleId, lines: linesQuery(lines), fromDate, days: String(DAYS_PER_PAGE) });
        const response = await fetch("/api/availability?" + query, { cache: "no-store", signal: request.signal });
        const result: DayAvailabilityResponse = await response.json();
        if (!active || request.signal.aborted) return;
        if (!result.ok) {
          setDays({ key: daysKey, data: null, error: result.error.message });
          return;
        }
        setDays({ key: daysKey, data: result.data, error: "" });
      } catch {
        if (active && !request.signal.aborted)
          setDays({ key: daysKey, data: null, error: "Could not refresh the days. Check your connection and retry." });
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 60000);
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", focus);
    };
  }, [vehicleId, lines, fromDate, daysKey, step, daysVersion, uncertain]);

  React.useEffect(() => {
    if (message) errorSummary.current?.focus();
  }, [message, fieldErrors]);

  const togglePick = (s: ServicePackage) => {
    setPicks((previous) =>
      previous.some((p) => p.serviceId === s.id)
        ? previous.filter((p) => p.serviceId !== s.id)
        : [...previous, { serviceId: s.id, quantity: 1 }],
    );
    setDay("");
  };
  const setQuantity = (serviceId: string, quantity: number) =>
    setPicks((previous) => previous.map((p) => (p.serviceId === serviceId ? { ...p, quantity } : p)));
  const newChallenge = () => setChallenge((c) => ({ version: c.version + 1, token: "" }));
  const onToken = React.useCallback((token: string) => setChallenge((c) => ({ ...c, token })), []);

  const next = async () => {
    if (submitting.current) return;
    setMessage("");
    setFieldErrors({});
    if (step === 1 && vehicle) {
      setStep(2);
      return;
    }
    if (step === 2) {
      if (lines.some((l) => serviceById(l.serviceId)?.type === "BASE")) setStep(3);
      else setMessage("Choose at least one main service.");
      return;
    }
    if (step === 3) {
      if (day && dayState === "AVAILABLE") setStep(4);
      else setMessage("Choose an available day.");
      return;
    }
    if (step !== 4) return;
    if (!attempt.current) {
      if (!quote || !day || dayState !== "AVAILABLE") {
        setStep(3);
        setMessage("Availability has changed. Please choose your day again.");
        return;
      }
      const built = createDayRequest({ form, quote, bookingDate: day, turnstileToken: challenge.token, idempotencyKey: crypto.randomUUID() });
      if (!built.ok) {
        setFieldErrors(built.fieldErrors);
        setMessage("Please check the highlighted details.");
        return;
      }
      attempt.current = built.data;
    } else {
      // Retrying an unconfirmed attempt: same retry key and details, fresh single-use token.
      attempt.current = { ...attempt.current, turnstileToken: challenge.token };
    }
    submitting.current = true;
    setPending(true);
    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: BOOKING_HEADERS,
        body: JSON.stringify(attempt.current),
        cache: "no-store",
      });
      const result: DayBookingResponse = await response.json();
      if (result.ok) {
        const sent = attempt.current;
        setBooking({
          view: result.data.booking,
          vehicleModel: sent.vehicleModel,
          vehiclePlate: sent.vehiclePlate ?? null,
          customerName: sent.customerName,
          customerPhone: sent.customerPhone,
          multiDay,
        });
        setStep(5);
        setUncertain(false);
        attempt.current = null;
        return;
      }
      const shown = publicCreateError(result.error);
      setFieldErrors(shown.fieldErrors);
      setMessage(shown.message);
      setUncertain(shown.uncertain);
      if (shown.newChallenge) newChallenge();
      if (shown.uncertain) return;
      attempt.current = null;
      if (shown.refreshQuote) setQuoteVersion((v) => v + 1);
      if (shown.step === "DAY") {
        setDay("");
        setStep(3);
        setDaysVersion((v) => v + 1);
      }
      if (shown.step === "SERVICES") {
        setStep(2);
        setCatalogVersion((v) => v + 1);
      }
    } catch {
      setUncertain(true);
      newChallenge();
      setMessage("The result could not be confirmed. Retry this same submission to recover your booking safely.");
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
  const STEP_LABELS = ["Vehicle", "Services", "Day", "Details & Review", "Booking Received"];
  const headings = ["Choose Vehicle Size", "Select Services", "Choose Your Day", "Details & Review", "Booking Received"];
  const servicesSummary = lines.map((l) => serviceById(l.serviceId)?.name).filter(Boolean).join(", ");

  const renderService = (s: ServicePackage) => {
    const pick = picked(s.id);
    const offer = offerLabel(s, vehicleId, pick?.quantity ?? 1);
    const Icon = getServiceDisciplineIcon(s.category);
    return (
      <div key={s.id}>
        <label
          className={
            panel +
            " flex min-h-[96px] items-center justify-between gap-4 transition-colors " +
            (!offer.bookable
              ? "cursor-not-allowed opacity-50"
              : pick
                ? "cursor-pointer border-primary bg-primary/5"
                : "cursor-pointer hover:border-zinc-500")
          }
        >
          <div className="flex items-start gap-3.5">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded border border-border bg-[#18181b]">
              <Icon className="h-5 w-5 text-primary shrink-0" aria-hidden="true" />
            </div>
            <div>
              <span className="block font-bold text-foreground">{s.name}</span>
              {s.description && <span className="mt-1 block text-sm text-muted-foreground">{s.description}</span>}
              <span className="mt-3 block text-sm font-semibold text-foreground">
                {offer.text}
                {s.unit === "PANEL" && offer.bookable ? " · per panel count" : ""}
              </span>
            </div>
          </div>
          <input
            type="checkbox"
            name="service"
            value={s.id}
            checked={Boolean(pick)}
            disabled={!offer.bookable || locked}
            onChange={() => togglePick(s)}
            className="h-5 w-5 shrink-0 accent-primary"
          />
        </label>
        {pick && s.unit === "PANEL" && (
          <div className="mt-2 rounded border border-border bg-[#121214] p-4">
            <label htmlFor={"panels-" + s.id} className="block text-sm font-semibold text-foreground">
              Number of panels for {s.name}
            </label>
            <input
              id={"panels-" + s.id}
              type="number"
              inputMode="numeric"
              min={1}
              max={20}
              value={pick.quantity}
              disabled={locked}
              onChange={(e) => setQuantity(s.id, Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
              className={control}
            />
          </div>
        )}
      </div>
    );
  };

  const renderTotal = () => (
    <>
      <dd className="mt-1 text-2xl font-extrabold tabular-nums tracking-tight text-foreground">
        {total ? total.amount : lines.length ? "Pricing…" : "—"}
      </dd>
      <p className="mt-1 text-xs text-zinc-400">
        {total?.note ?? "Taxes, professional consumables & shop service included."}
      </p>
    </>
  );

  // Persistent Booking Summary Sidebar (Recognition over Recall)
  const renderSummarySidebar = () => (
    <aside aria-label="Booking Summary" className="hidden lg:col-span-4 lg:block">
      <div className="sticky top-6 rounded border border-border bg-[#121214] p-6 shadow-sm">
        <div className="border-b border-border pb-4">
          <h2 className="text-xs font-bold uppercase tracking-wider text-primary">Booking Summary</h2>
        </div>

        <dl className="mt-4 space-y-4 text-sm">
          <div>
            <div className="flex items-center justify-between">
              <dt className="text-xs font-medium text-muted-foreground">Vehicle Size</dt>
              <button
                type="button"
                onClick={() => {
                  setStep(1);
                  setMessage("");
                }}
                disabled={locked}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-end text-xs font-semibold text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
              >
                Change
              </button>
            </div>
            <dd className="font-bold text-foreground">{vehicle?.name ?? "—"}</dd>
          </div>

          <div className="border-t border-border/60 pt-3">
            <div className="flex items-center justify-between">
              <dt className="text-xs font-medium text-muted-foreground">Services</dt>
              {step > 2 && (
                <button
                  type="button"
                  onClick={() => {
                    setStep(2);
                    setMessage("");
                  }}
                  disabled={locked}
                  className="inline-flex min-h-[44px] min-w-[44px] items-center justify-end text-xs font-semibold text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Change
                </button>
              )}
            </div>
            <dd className="font-bold text-foreground">{servicesSummary || "Selecting services…"}</dd>
          </div>

          {step >= 3 && (
            <div className="border-t border-border/60 pt-3">
              <div className="flex items-center justify-between">
                <dt className="text-xs font-medium text-muted-foreground">{multiDay ? "Drop-off Day" : "Booking Day"}</dt>
                {step > 3 && (
                  <button
                    type="button"
                    onClick={() => {
                      setStep(3);
                      setMessage("");
                    }}
                    disabled={locked}
                    className="inline-flex min-h-[44px] min-w-[44px] items-center justify-end text-xs font-semibold text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Change
                  </button>
                )}
              </div>
              <dd className="font-bold text-foreground">{day ? dateLabel(day) : "Choose a day"}</dd>
            </div>
          )}

          <div className="border-t border-border pt-4">
            <dt className="text-xs font-medium text-muted-foreground">{total?.label ?? "Estimated Investment"}</dt>
            {renderTotal()}
          </div>
        </dl>
      </div>
    </aside>
  );

  // Mobile persistent summary tray for Steps 2-4
  const renderMobileSummaryTray = () => (
    <div className="mb-6 rounded border border-border bg-[#121214] p-4 text-sm lg:hidden">
      <div className="flex items-start justify-between gap-3 border-b border-border/60 pb-3">
        <div className="min-w-0">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-primary">Your Booking</span>
          <p className="break-words font-bold text-foreground">{servicesSummary || "Selecting services…"}</p>
          <p className="text-xs text-muted-foreground">{vehicle?.name}</p>
        </div>
        <div className="text-right shrink-0">
          <span className="text-base font-extrabold tabular-nums text-foreground">
            {total ? total.amount : lines.length ? "Pricing…" : "—"}
          </span>
          {total && total.label !== "Total" && <p className="text-[11px] font-medium text-primary">Estimate</p>}
        </div>
      </div>
      <div className="mt-2.5 flex items-center justify-between text-xs">
        <span className="text-zinc-400">
          {step === 2 ? "Select services" : day ? dateLabel(day) : "Choose a day below"}
        </span>
        <button
          type="button"
          onClick={() => {
            setStep(1);
            setMessage("");
          }}
          disabled={locked}
          className="inline-flex min-h-[44px] items-center px-1 font-semibold text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
        >
          Change setup
        </button>
      </div>
    </div>
  );

  const quoteLines = quote?.lines ?? [];

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
          <Link href="/" aria-label="Return to home" className="inline-flex min-h-[44px] items-center">
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
          <div className="h-full bg-primary motion-safe:transition-all" style={{ width: step * 20 + "%" }} />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="mb-8 max-w-3xl">
          <h1 className="text-2xl font-bold sm:text-3xl">{headings[step - 1]}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Days are shown in Asia/Manila (UTC+8). You join that day&apos;s queue and the shop confirms your booking.
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
                <a className="inline-flex min-h-[44px] items-center underline" href={step === 4 ? "#" + field : "#booking-days"}>
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
            <button type="button" onClick={retryCatalog} className="mt-4 min-h-[44px] underline">
              Retry service menu
            </button>
          </div>
        )}

        {/* Step 1: Vehicle Size (Full Width) */}
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
                Choose your vehicle size. Prices are set per size.
              </legend>
              {catalog.vehicleCategories.map((v) => {
                const VehicleIcon = getVehicleCategoryIcon(v.code);
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
                        {v.description && <span className="text-sm text-muted-foreground">{v.description}</span>}
                      </div>
                    </div>
                    <input
                      type="radio"
                      name="vehicle-category"
                      value={v.id}
                      checked={vehicleId === v.id}
                      onChange={() => {
                        setVehicleId(v.id);
                        setDay("");
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
            <div className="min-w-0 lg:col-span-8">
              {renderMobileSummaryTray()}

              {/* Step 2: Services and add-ons */}
              {step === 2 && (
                <div className="space-y-8">
                  <fieldset className="space-y-3">
                    <legend className="mb-3 text-sm text-muted-foreground">
                      Choose one or more services for your {vehicle?.name}. &quot;For quote&quot; services are booked now and priced by the shop.
                    </legend>
                    {bases.map(renderService)}
                  </fieldset>
                  {addOns.length > 0 && (
                    <fieldset className="space-y-3">
                      <legend className="mb-3 text-sm font-semibold text-foreground">Add-ons for your chosen services</legend>
                      {addOns.map(renderService)}
                    </fieldset>
                  )}
                  {quoteState?.key === selectionKey && quoteState.error && (
                    <div role="alert" className="text-sm text-destructive">
                      <p>{quoteState.error}</p>
                      <button type="button" onClick={() => setQuoteVersion((v) => v + 1)} className="mt-2 min-h-[44px] text-xs underline">
                        Retry pricing
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Step 3: Day picker (no times, counts or positions) */}
              {step === 3 && (
                <section id="booking-days" aria-labelledby="days-title" aria-busy={!liveDays} className={panel}>
                  <div className="flex items-baseline justify-between border-b border-border pb-3">
                    <div>
                      <h2 id="days-title" className="text-lg font-bold text-foreground">
                        {multiDay ? "Available drop-off days" : "Available days"}
                      </h2>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {shortDayLabel(fromDate)} – {shortDayLabel(addDays(fromDate, DAYS_PER_PAGE - 1))}
                      </p>
                    </div>
                    <span className="rounded bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">Live availability</span>
                  </div>

                  {!liveDays && (
                    <div role="status" className="mt-6 grid grid-cols-2 gap-3">
                      <span className="sr-only">Loading days</span>
                      {[0, 1, 2, 3].map((i) => (
                        <div key={i} className="h-16 rounded bg-muted motion-safe:animate-pulse" />
                      ))}
                    </div>
                  )}

                  {liveDays?.error && (
                    <div role="alert" className="mt-4">
                      <p className="text-sm text-destructive">{liveDays.error}</p>
                      <button type="button" onClick={() => setDaysVersion((v) => v + 1)} className="mt-2 min-h-[44px] text-xs underline">
                        Retry days
                      </button>
                    </div>
                  )}

                  {liveDays?.data && (
                    <>
                      <p role="status" aria-live="polite" className="my-3 text-xs text-zinc-400">
                        {liveDays.data.onlineBookingStatus === "PAUSED"
                          ? `Online booking is paused right now. Please call the shop at ${brandConfig.displayPhone}.`
                          : liveDays.data.nextAvailableDay
                            ? `Next available day: ${dateLabel(liveDays.data.nextAvailableDay)}.`
                            : `No available day was found. Please call the shop at ${brandConfig.displayPhone}.`}
                      </p>
                      <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <legend className="sr-only">Days</legend>
                        {liveDays.data.days.map((d) => {
                          const selectable = d.state === "AVAILABLE";
                          // A day that stopped being available is shown, but no longer chosen.
                          const selected = selectable && day === d.date;
                          return (
                            <label
                              key={d.date}
                              className={`flex min-h-[64px] items-center justify-between gap-3 rounded border px-4 py-3 transition-colors ${
                                !selectable
                                  ? "cursor-not-allowed border-border opacity-50 bg-[#121214]/60"
                                  : selected
                                    ? "border-primary bg-primary/10 shadow-sm"
                                    : "cursor-pointer border-input bg-card hover:border-zinc-500"
                              }`}
                            >
                              <div>
                                <span className="block font-semibold text-foreground">{shortDayLabel(d.date)}</span>
                                <span className="block text-xs text-muted-foreground">{dayStateLabel(d.state)}</span>
                              </div>
                              <input
                                type="radio"
                                name="booking-day"
                                aria-label={`${dateLabel(d.date)} — ${dayStateLabel(d.state)}`}
                                checked={selected}
                                disabled={!selectable}
                                onChange={() => setDay(d.date)}
                                className="h-5 w-5 shrink-0 accent-primary"
                              />
                            </label>
                          );
                        })}
                      </fieldset>
                    </>
                  )}

                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => setFromDate((f) => (addDays(f, -DAYS_PER_PAGE) < todayInManila() ? todayInManila() : addDays(f, -DAYS_PER_PAGE)))}
                      disabled={fromDate <= todayInManila()}
                      className="inline-flex min-h-[44px] items-center gap-2 rounded border border-primary/40 bg-primary/10 px-4 py-2 text-xs font-bold text-primary hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                      Earlier days
                    </button>
                    <button
                      type="button"
                      onClick={() => setFromDate((f) => addDays(f, DAYS_PER_PAGE))}
                      disabled={addDays(fromDate, DAYS_PER_PAGE) > lastDay}
                      className="inline-flex min-h-[44px] items-center gap-2 rounded border border-primary/40 bg-primary/10 px-4 py-2 text-xs font-bold text-primary hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <CalendarDays className="h-4 w-4" aria-hidden="true" />
                      Later days
                    </button>
                  </div>

                  <div className="mt-4 flex items-start gap-2.5 rounded border border-border/60 bg-[#121214] p-3 text-xs text-zinc-400">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <p>
                      <strong className="text-foreground">Availability Notice:</strong> Choosing a day does not hold a place. Your place in that day&apos;s queue is set when your booking request is submitted.
                      {multiDay && " This job takes more than one day: the chosen day is your drop-off day."}
                    </p>
                  </div>
                </section>
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
                      <h2 className="text-sm font-bold uppercase tracking-wider text-primary">Pre-Submission Review</h2>
                      <span className="rounded bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">Step 4 of 5</span>
                    </div>

                    <div className="mt-3 divide-y divide-border/60 text-sm">
                      <div className="flex items-start justify-between py-3">
                        <div>
                          <span className="block text-xs font-medium text-muted-foreground">Vehicle Size</span>
                          <span className="font-bold text-foreground">{vehicle?.name ?? "—"}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setStep(1);
                            setMessage("");
                          }}
                          disabled={locked}
                          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center px-2 text-xs font-semibold text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label="Edit vehicle size"
                        >
                          Edit
                        </button>
                      </div>

                      <div className="flex items-start justify-between py-3">
                        <div className="min-w-0">
                          <span className="block text-xs font-medium text-muted-foreground">Services</span>
                          <ul className="mt-1 space-y-1">
                            {quoteLines.map((l) => (
                              <li key={l.serviceId} className="break-words">
                                <span className="font-bold text-foreground">
                                  {l.name}
                                  {l.unit === "PANEL" ? ` × ${l.quantity} panels` : ""}
                                </span>{" "}
                                <span className="text-xs text-zinc-400">· {lineAmount(l)}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setStep(2);
                            setMessage("");
                          }}
                          disabled={locked}
                          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center px-2 text-xs font-semibold text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label="Edit services"
                        >
                          Edit
                        </button>
                      </div>

                      <div className="flex items-start justify-between py-3">
                        <div>
                          <span className="block text-xs font-medium text-muted-foreground">{multiDay ? "Drop-off Day" : "Booking Day"}</span>
                          <span className="font-bold text-foreground">{day ? dateLabel(day) : "Choose a day"}</span>
                          <p className="text-xs text-zinc-400">
                            {multiDay
                              ? "This job takes more than one day: bring your car on this day."
                              : "Timezone: Asia/Manila (UTC+8)"}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setStep(3);
                            setMessage("");
                          }}
                          disabled={locked}
                          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center px-2 text-xs font-semibold text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                          aria-label="Edit booking day"
                        >
                          Edit
                        </button>
                      </div>

                      <div className="pt-3">
                        <div className="flex items-baseline justify-between">
                          <span className="text-xs font-medium text-muted-foreground">{total?.label ?? "Estimated Investment"}</span>
                          <span className="text-2xl font-extrabold tabular-nums tracking-tight text-foreground">
                            {total ? total.amount : "Pricing…"}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-zinc-400">
                          {total?.note ?? "Taxes, professional consumables & shop service included."}
                        </p>
                      </div>
                    </div>
                  </div>

                  {uncertain && (
                    <p className="mb-6 rounded border border-warning/50 bg-warning/10 p-3 text-sm text-warning">
                      Your submitted details are held unchanged while the confirmation is uncertain. Retry to safely recover your booking request.
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
                        onChange={(e) => setForm((prev) => ({ ...prev, customerName: e.target.value }))}
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
                        onChange={(e) => setForm((prev) => ({ ...prev, customerPhone: formatPhilippinePhone(e.target.value) }))}
                        placeholder="0930 016 2234"
                        aria-invalid={Boolean(errorFor("customerPhone"))}
                        aria-describedby={errorFor("customerPhone") ? "customerPhone-error" : "customerPhone-help"}
                        className={`${control} ${errorFor("customerPhone") ? "border-destructive ring-1 ring-destructive" : ""}`}
                      />
                      <p id="customerPhone-help" className="mt-1.5 text-xs text-zinc-400">
                        Format: 09XX XXX XXXX or +63 9XX XXX XXXX for shop contact and booking updates.
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
                        onChange={(e) => setForm((prev) => ({ ...prev, customerEmail: e.target.value }))}
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
                        required
                        value={form.vehicleModel}
                        onChange={(e) => setForm((prev) => ({ ...prev, vehicleModel: e.target.value }))}
                        placeholder="e.g. Toyota Vios"
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
                        onChange={(e) => setForm((prev) => ({ ...prev, vehiclePlate: e.target.value }))}
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
                        onChange={(e) => setForm((prev) => ({ ...prev, specialRequests: e.target.value }))}
                        placeholder="Specific scratches, previous ceramic coating brand, interior stains, or drop-off preferences…"
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

                    {/* Security check (Cloudflare Turnstile) */}
                    <div id="turnstileToken">
                      <span className="text-sm font-semibold text-foreground">Security check</span>
                      <div className="mt-2">
                        {TURNSTILE_SITE_KEY ? (
                          <TurnstileChallenge key={challenge.version} siteKey={TURNSTILE_SITE_KEY} onToken={onToken} />
                        ) : (
                          <p className="text-xs text-destructive">
                            Online booking is not available right now. Please call the shop at {brandConfig.displayPhone}.
                          </p>
                        )}
                      </div>
                      {errorFor("turnstileToken") && (
                        <p className="mt-1.5 text-xs text-destructive">{errorFor("turnstileToken")}</p>
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
            <section aria-labelledby="reference-title" className={`${panel} print-receipt-card`}>
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
                <div className="flex items-center gap-3">
                  <ShieldCheck aria-hidden="true" className="h-8 w-8 text-primary shrink-0" />
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                      {booking.view.status === "CONFIRMED" ? "Booking Confirmed" : "Booking Received"}
                    </p>
                    <h2 id="reference-title" className="text-2xl font-extrabold tabular-nums tracking-tight text-foreground sm:text-3xl">
                      {booking.view.referenceCode}
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
                {booking.view.status === "CONFIRMED"
                  ? "Your booking is confirmed. Please bring your car on your booking day."
                  : "We have received your booking request. Our shop team will review it and contact you to confirm."}
              </p>

              <dl className="mt-6 divide-y divide-border/60 text-sm">
                <div className="py-3">
                  <dt className="text-xs text-muted-foreground">{booking.multiDay ? "Drop-off Day" : "Booking Day"}</dt>
                  <dd className="mt-0.5 font-bold text-foreground">
                    {dateLabel(booking.view.bookingDate)} · {booking.view.timezone}
                  </dd>
                  {booking.multiDay && (
                    <p className="mt-0.5 text-xs text-zinc-400">
                      This job takes more than one day. Your chosen day is the drop-off day; the shop tells you when your car is ready.
                    </p>
                  )}
                </div>
                <div className="py-3">
                  <dt className="text-xs text-muted-foreground">Services</dt>
                  <dd className="mt-0.5 text-foreground">
                    <ul className="space-y-1">
                      {booking.view.lines.map((l) => (
                        <li key={l.serviceId} className="break-words">
                          <span className="font-semibold">
                            {l.name}
                            {l.quantity > 1 ? ` × ${l.quantity}` : ""}
                          </span>{" "}
                          <span className="text-xs text-zinc-400">· {lineAmount(l)}</span>
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
                <div className="py-3">
                  <dt className="text-xs text-muted-foreground">Vehicle</dt>
                  <dd className="mt-0.5 break-words text-foreground">
                    {booking.view.vehicleCategoryName} · {booking.vehicleModel} · {booking.vehiclePlate ?? "No plate"}
                  </dd>
                </div>
                <div className="py-3">
                  <dt className="text-xs text-muted-foreground">Customer Contact</dt>
                  <dd className="mt-0.5 text-foreground">
                    {booking.customerName} · {booking.customerPhone}
                  </dd>
                </div>
                <div className="py-3">
                  <dt className="text-xs text-muted-foreground">{quoteTotal(booking.view).label}</dt>
                  <dd className="mt-1 text-2xl font-extrabold tabular-nums text-foreground">{quoteTotal(booking.view).amount}</dd>
                  <p className="mt-0.5 text-xs text-zinc-400">
                    {quoteTotal(booking.view).note ?? "Includes labor, professional coatings/compounds, and shop supplies."}
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
                  <strong className="text-foreground">Next Steps:</strong>{" "}
                  {booking.view.status === "CONFIRMED" ? (
                    <>Your booking is <span className="font-semibold text-primary">CONFIRMED</span>. Please save or print this receipt for your visit.</>
                  ) : (
                    <>Your booking is currently <span className="font-semibold text-primary">PENDING</span> shop confirmation. Our shop team will review your booking request and contact you to confirm. Please save or print this receipt for your visit.</>
                  )}
                </p>
              </div>
            </section>

            {/* Post-Booking Assistance: Contact Shop Card */}
            <div className={`${panel} no-print`}>
              <h3 className="text-base font-bold text-foreground">Contact Shop About This Booking</h3>
              <p className="mt-1 text-xs text-zinc-400">
                Have questions or need to change your day? Reach out directly to Zeus Auto Detailing with reference code{" "}
                <span className="font-mono font-semibold text-primary">{booking.view.referenceCode}</span>.
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
                  href={`${brandConfig.facebookMessengerUrl}?text=${encodeURIComponent(`Hi, I have a booking inquiry for reference code ${booking.view.referenceCode}.`)}`}
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
                  (step === 2 && !lines.length) ||
                  (step === 3 && (!day || dayState !== "AVAILABLE")) ||
                  (step === 4 && (!challenge.token || (!uncertain && !quote)))
                }
                className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded bg-primary px-6 py-3 font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending
                  ? "Submitting request…"
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
            <p className="ml-auto mt-3 max-w-[70ch] text-right text-xs text-zinc-400">
              Submitting adds your car to that day&apos;s queue as a PENDING booking request. Our shop will review it and contact you to confirm.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
