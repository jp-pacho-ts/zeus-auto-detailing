"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  Bike,
  Car,
  CarFront,
  Check,
  ChevronDown,
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
import { TurnstileChallenge, type ChallengeStatus } from "@/components/booking/turnstile";
import { DayPicker, DAYS_PER_PAGE, dateLabel, todayInManila } from "@/components/booking/day-picker";
import { ManagementCode } from "@/components/booking/management-code";
import { PaymentInstructions } from "@/components/booking/payment-instructions";
import { bookingStatusWords } from "@/components/booking/manage-booking";
import { reveal } from "@/components/booking/reveal";
import {
  CATEGORY_NAMES,
  CATEGORY_ORDER,
  arrivalWords,
  availableAddOns,
  createDayRequest,
  isMultiDay,
  lineAmount,
  money,
  offerLabel,
  publicCreateError,
  quoteTotal,
  resolveDeepLink,
  selectionLines,
  serviceDetail,
  type DetailsForm,
  type ServicePick,
} from "@/components/booking/day-booking";
import type {
  BookingCatalog,
  BookingCatalogResponse,
  BookingQuote,
  BookingQuoteResponse,
  CatalogServiceKind,
  ServicePackage,
} from "@/types/catalog-contracts";
import type {
  CreateDayBookingRequest,
  DayAvailabilityData,
  DayAvailabilityResponse,
  DayBookingResponse,
  DayBookingView,
  ManagementAccessGrant,
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

const linesQuery = (lines: ServicePick[]) => lines.map((l) => l.serviceId + ":" + l.quantity).join(",");
const BOOKING_HEADERS = { "content-type": "application/json", "x-zeus-booking": "1" };

const control =
  "mt-2 min-h-[48px] w-full rounded border border-input bg-card px-4 py-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 transition-colors";
// L9: less padding on phones so the security check fits a 320 px screen.
const panel = "rounded border border-border bg-card p-4 sm:p-8";
// L5: option cards have a visible edge (input token, 6.9:1) and a focus ring on the whole card.
const optionCard = (selected: boolean) =>
  "flex cursor-pointer items-center justify-between gap-4 rounded border p-4 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring sm:p-5 " +
  (selected ? "border-primary bg-primary/5" : "border-input bg-card hover:border-primary");
const changeLink =
  "inline-flex min-h-[44px] min-w-[44px] items-center justify-end text-sm font-semibold text-primary hover:underline disabled:cursor-not-allowed disabled:opacity-50";

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

// L4: four steps the customer acts on; the receipt is not a step.
const STEP_LABELS = ["Vehicle size", "Services", "Day", "Your details"];
const HEADINGS = ["Choose your vehicle size", "Choose your services", "Choose your day", "Your details", "Booking received"];
// The normal security-check widget is a fixed 300 px wide; below this it is rendered compact.
const NARROW_QUERY = "(max-width: 359px)";

export function BookingWizard({
  initialServiceId,
  initialVehicleName,
}: {
  initialServiceId?: string;
  initialVehicleName?: string;
}) {
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
  const [step, setStep] = React.useState(1);
  const [catalog, setCatalog] = React.useState<BookingCatalog | null>(null);
  const [catalogError, setCatalogError] = React.useState("");
  const [catalogVersion, setCatalogVersion] = React.useState(0);
  const [vehicleId, setVehicleId] = React.useState("");
  const [picks, setPicks] = React.useState<ServicePick[]>([]);
  const [openCategory, setOpenCategory] = React.useState<CatalogServiceKind | null>(null);
  const [panelDrafts, setPanelDrafts] = React.useState<Record<string, string>>({});
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
  const [challengeStatus, setChallengeStatus] = React.useState<ChallengeStatus>("pending");
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [message, setMessage] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [uncertain, setUncertain] = React.useState(false);
  // The management code stays in memory only (ADR-002): never in the URL or browser storage.
  const [booking, setBooking] = React.useState<{ view: DayBookingView; access: ManagementAccessGrant | null; vehicleModel: string; vehiclePlate: string | null; customerName: string; customerPhone: string; multiDay: boolean } | null>(null);

  const submitting = React.useRef(false);
  const attempt = React.useRef<CreateDayBookingRequest | null>(null);
  const errorSummary = React.useRef<HTMLDivElement>(null);
  const deepLinkHandled = React.useRef(false);
  const shownStep = React.useRef(step);
  // L9 / QA F2: below 360 px the security check is compact. It follows the window as it resizes,
  // not only when something else happens to re-render the form.
  const [narrow, setNarrow] = React.useState(
    () => typeof window !== "undefined" && Boolean(window.matchMedia?.(NARROW_QUERY).matches),
  );

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
  // The newest signed quote for this selection: the day list carries a fresh one too.
  const quote: BookingQuote | null =
    (liveDays?.data?.quote && quoteState?.key === selectionKey && quoteState.quote
      ? Date.parse(liveDays.data.quote.issuedAt) >= Date.parse(quoteState.quote.issuedAt)
        ? liveDays.data.quote
        : quoteState.quote
      : liveDays?.data?.quote ?? (quoteState?.key === selectionKey ? quoteState.quote : null)) ?? null;
  const total = quote ? quoteTotal(quote) : null;
  const dayState = liveDays?.data?.days.find((d) => d.date === day)?.state;
  // W10: a chosen day survives a size or service change while it is still available; otherwise it
  // counts as not chosen and the customer is told why.
  const dayGone = Boolean(day) && dayState !== undefined && dayState !== "AVAILABLE";
  const chosenDay = dayGone ? "" : day;
  const dayNote = dayGone ? dateLabel(day) + " isn't available for this choice. Choose another day." : "";
  const paused = liveDays?.data?.onlineBookingStatus === "PAUSED";
  const multiDay = catalog ? isMultiDay(catalog, lines.map((l) => l.serviceId)) : false;
  const serviceById = (id: string) => catalog?.services.find((s) => s.id === id);
  const bases = catalog?.services.filter((s) => s.type === "BASE") ?? [];
  const picked = (id: string) => picks.find((p) => p.serviceId === id);
  const offered = (s: ServicePackage) => Boolean(vehicleId) && offerLabel(s, vehicleId).bookable;

  // Inline validation checks for Step 4
  const isPhoneValid = /^(09\d{9}|\+639\d{9})$/.test(form.customerPhone.replace(/[\s()\-]/g, ""));
  const isNameValid = form.customerName.trim().length >= 2;
  const isModelValid = form.vehicleModel.trim().length >= 2;

  // Moves to a step. The service step opens the category of the first chosen main service.
  const goTo = (target: number) => {
    setMessage("");
    setFieldErrors({});
    if (target === 2) {
      const first = picks.map((p) => serviceById(p.serviceId)).find((s) => s?.type === "BASE");
      setOpenCategory(first ? first.category : null);
    }
    setStep(target);
  };

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
            if (link.serviceId) {
              setPicks([{ serviceId: link.serviceId, quantity: 1 }]);
              setOpenCategory(data.services.find((s) => s.id === link.serviceId)?.category ?? null);
            }
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

  // W1: every new step opens at its top with focus on its heading (not on first load).
  React.useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    reveal("wizard-step-title");
  }, [step]);

  React.useEffect(() => {
    const query = window.matchMedia?.(NARROW_QUERY);
    if (!query?.addEventListener) return;
    const update = () => setNarrow(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  // QA F1: a keyboard-focused control is never hidden by the fixed phone action bar. The page's
  // scroll padding follows the bar's measured height (it grows when a reason line wraps; 0 on
  // desktop, where the bar is hidden). The browser leaves a partly visible control (a tall text box)
  // where it is, so after each focus the control is brought fully into the padded view.
  const barShown = step < 5;
  React.useEffect(() => {
    if (!barShown || typeof ResizeObserver === "undefined") return;
    const bar = document.getElementById("wizard-action-bar");
    if (!bar) return;
    const root = document.documentElement;
    const apply = () => {
      root.style.scrollPaddingBottom = bar.offsetHeight ? bar.offsetHeight + 16 + "px" : "";
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(bar);
    const keepClear = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || bar.contains(target) || !bar.offsetHeight) return;
      // After the browser's own focus scroll; an instant scroll also ends a smooth one in progress.
      window.requestAnimationFrame(() => target.scrollIntoView({ block: "nearest", behavior: "instant" }));
    };
    document.addEventListener("focusin", keepClear);
    return () => {
      observer.disconnect();
      document.removeEventListener("focusin", keepClear);
      root.style.scrollPaddingBottom = "";
    };
  }, [barShown]);

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

  const togglePick = (s: ServicePackage) =>
    setPicks((previous) =>
      previous.some((p) => p.serviceId === s.id)
        ? previous.filter((p) => p.serviceId !== s.id)
        : [...previous, { serviceId: s.id, quantity: 1 }],
    );
  const setQuantity = (serviceId: string, quantity: number) =>
    setPicks((previous) => previous.map((p) => (p.serviceId === serviceId ? { ...p, quantity } : p)));
  const newChallenge = () => {
    setChallenge((c) => ({ version: c.version + 1, token: "" }));
    setChallengeStatus("pending");
  };
  const onToken = React.useCallback((token: string) => setChallenge((c) => ({ ...c, token })), []);
  const onChallengeStatus = React.useCallback((status: ChallengeStatus) => setChallengeStatus(status), []);

  const next = async () => {
    if (submitting.current) return;
    setMessage("");
    setFieldErrors({});
    if (step === 1 && vehicle) {
      goTo(2);
      return;
    }
    if (step === 2) {
      if (lines.some((l) => serviceById(l.serviceId)?.type === "BASE")) goTo(3);
      else setMessage("Choose at least one main service.");
      return;
    }
    if (step === 3) {
      if (day && dayState === "AVAILABLE") goTo(4);
      else setMessage("Choose an available day.");
      return;
    }
    if (step !== 4) return;
    if (!attempt.current) {
      if (!quote || !day || dayState !== "AVAILABLE") {
        goTo(3);
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
          access: result.data.managementAccess,
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
  const servicesSummary = lines.map((l) => serviceById(l.serviceId)?.name).filter(Boolean).join(", ");
  const quoteLines = quote?.lines ?? [];

  // W5: a disabled Submit always says why.
  const submitReason =
    step !== 4 || pending
      ? ""
      : !turnstileSiteKey
        ? `Online booking is not available right now. Please call the shop at ${brandConfig.displayPhone}.`
        : !challenge.token
          ? challengeStatus === "expired"
            ? "The security check expired. It restarts by itself; then send your request."
            : challengeStatus === "failed"
              ? "The security check didn't load. Check your connection, then reload the page."
              : "Waiting for the security check…"
          : !uncertain && !quote
            ? "Updating the price…"
            : "";
  const primaryDisabled =
    pending ||
    !catalog ||
    Boolean(catalogError) ||
    (step === 1 && !vehicleId) ||
    (step === 2 && !lines.length) ||
    (step === 3 && (!day || dayState !== "AVAILABLE")) ||
    (step === 4 && (!challenge.token || (!uncertain && !quote)));
  const showPrimary = step < 5 && !(step === 3 && paused);

  const renderPrimary = () => (
    <button
      type={step === 4 ? "submit" : "button"}
      form={step === 4 ? "booking-details" : undefined}
      onClick={(event) => {
        if (step !== 4) {
          event.preventDefault();
          void next();
        }
      }}
      disabled={primaryDisabled}
      className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded bg-primary px-5 py-3 font-bold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Submitting request…" : step === 4 ? (uncertain ? "Retry same submission" : "Submit booking request") : "Continue"}
      <ArrowRight aria-hidden="true" className="h-4 w-4" />
    </button>
  );
  const renderBack = () =>
    step > 1 && step < 5 ? (
      <button
        type="button"
        disabled={locked}
        onClick={() => goTo(step - 1)}
        className="inline-flex min-h-[44px] items-center gap-1 px-1 text-sm font-semibold text-foreground underline-offset-4 hover:underline disabled:opacity-50"
      >
        <ChevronLeft aria-hidden="true" className="h-4 w-4" />
        Back
      </button>
    ) : null;
  const renderTotal = () =>
    step === 1 ? (
      <span className="text-sm text-muted-foreground">{vehicle ? vehicle.name : "Choose a size"}</span>
    ) : lines.length ? (
      <>
        <span className="block text-sm text-muted-foreground">{total?.label ?? "Estimated total"}</span>
        <span className="block text-lg font-extrabold tabular-nums text-foreground">{total ? total.amount : "Pricing…"}</span>
      </>
    ) : (
      <span className="text-sm text-muted-foreground">Nothing chosen yet</span>
    );
  const renderReason = () => (submitReason ? <p className="mt-2 text-sm text-muted-foreground" role="status">{submitReason}</p> : null);

  // The single review: the desktop summary card (with the primary action) and, on phones, the block
  // after the details (L2). Each Change returns to its step.
  const renderReview = () => (
    <dl className="space-y-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <dt className="text-muted-foreground">Vehicle size</dt>
          <dd className="font-bold text-foreground">{vehicle?.name ?? "—"}</dd>
        </div>
        <button type="button" onClick={() => goTo(1)} disabled={locked} className={changeLink} aria-label="Change vehicle size">
          Change
        </button>
      </div>
      {step > 1 && (
        <div className="flex items-start justify-between gap-3 border-t border-border/60 pt-3">
          <div className="min-w-0">
            <dt className="text-muted-foreground">Services</dt>
            <dd className="text-foreground">
              {step === 4 && quoteLines.length ? (
                <ul className="space-y-1">
                  {quoteLines.map((l) => (
                    <li key={l.serviceId} className="break-words">
                      <span className="font-bold">
                        {l.name}
                        {l.unit === "PANEL" ? ` × ${l.quantity} panels` : ""}
                      </span>{" "}
                      <span className="text-muted-foreground">· {lineAmount(l)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="font-bold">{servicesSummary || "Not chosen yet"}</span>
              )}
            </dd>
          </div>
          {step > 2 && (
            <button type="button" onClick={() => goTo(2)} disabled={locked} className={changeLink} aria-label="Change services">
              Change
            </button>
          )}
        </div>
      )}
      {step > 2 && (
        <div className="flex items-start justify-between gap-3 border-t border-border/60 pt-3">
          <div className="min-w-0">
            <dt className="text-muted-foreground">{multiDay ? "Drop-off day" : "Day"}</dt>
            <dd className="font-bold text-foreground">{chosenDay ? dateLabel(chosenDay) : "Not chosen yet"}</dd>
          </div>
          {step > 3 && (
            <button type="button" onClick={() => goTo(3)} disabled={locked} className={changeLink} aria-label="Change day">
              Change
            </button>
          )}
        </div>
      )}
      <div className="border-t border-border pt-3">
        <dt className="text-muted-foreground">{total?.label ?? "Estimated total"}</dt>
        <dd className="text-2xl font-extrabold tabular-nums tracking-tight text-foreground">{total ? total.amount : lines.length ? "Pricing…" : "—"}</dd>
        {total?.note && <p className="mt-1 text-sm text-muted-foreground">{total.note}</p>}
      </div>
    </dl>
  );

  // Desktop: the summary stays in view beside the choices and holds the primary action (L1).
  const renderSummarySidebar = () => (
    <aside aria-label="Your booking" className="hidden lg:col-span-4 lg:block">
      <div className="sticky top-6 rounded border border-border bg-[#121214] p-6">
        <h2 className="mb-4 text-base font-bold text-foreground">Your booking</h2>
        {renderReview()}
        {showPrimary && <div className="mt-6 flex flex-col gap-2 [&>button]:w-full">{renderPrimary()}</div>}
        {renderReason()}
        <div className="mt-3">{renderBack()}</div>
      </div>
    </aside>
  );

  // Phones, services and day steps: what is chosen so far, above the choices.
  const renderMobileSummaryTray = () => (
    <div className="mb-6 rounded border border-border bg-[#121214] p-4 text-sm lg:hidden">
      <p className="font-bold text-foreground">{vehicle?.name}</p>
      <p className="break-words text-muted-foreground">{servicesSummary || "No service chosen yet"}</p>
      {step === 3 && chosenDay && <p className="text-muted-foreground">{dateLabel(chosenDay)}</p>}
      <button type="button" onClick={() => goTo(1)} disabled={locked} className="mt-1 inline-flex min-h-[44px] items-center font-semibold text-primary hover:underline disabled:opacity-50">
        Change size
      </button>
    </div>
  );

  // W3: the add-ons offered for a ticked main service, shown directly under it.
  const addOnsUnder = (base: ServicePackage) => {
    if (!catalog || !picked(base.id)) return [];
    return availableAddOns(catalog, [base.id]).filter((a) => {
      if (!offered(a)) return false;
      const host = lines.find((l) => catalog.addOnCompatibility.some((c) => c.baseServiceId === l.serviceId && c.addOnServiceId === a.id));
      return host?.serviceId === base.id;
    });
  };

  const renderService = (s: ServicePackage, nested = false) => {
    const pick = picked(s.id);
    const offer = offerLabel(s, vehicleId, pick?.quantity ?? 1);
    const Icon = getServiceDisciplineIcon(s.category);
    const detail = serviceDetail(s);
    const extras = nested ? [] : addOnsUnder(s);
    return (
      <li key={s.id}>
        <label className={optionCard(Boolean(pick)) + " min-h-[80px]"}>
          <div className="flex items-start gap-3.5">
            {!nested && (
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded border border-border bg-[#18181b]">
                <Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              </div>
            )}
            <div>
              <span className="block font-bold text-foreground">{s.name}</span>
              {detail && <span className="mt-1 block text-sm text-muted-foreground">{detail}</span>}
              <span className="mt-2 block text-sm font-semibold text-foreground">
                {offer.text}
                {s.unit === "PANEL" ? " · per panel count" : ""}
              </span>
            </div>
          </div>
          <input
            type="checkbox"
            name="service"
            value={s.id}
            checked={Boolean(pick)}
            disabled={locked}
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
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              aria-describedby={"panels-help-" + s.id}
              value={panelDrafts[s.id] ?? String(pick.quantity)}
              disabled={locked}
              onChange={(e) => {
                // W13: the field may be empty while typing; a count from 1 to 20 is applied at once.
                const draft = e.target.value.replace(/\D/g, "").slice(0, 2);
                setPanelDrafts((d) => ({ ...d, [s.id]: draft }));
                const n = Number(draft);
                if (n >= 1 && n <= 20) setQuantity(s.id, n);
              }}
              onBlur={() => {
                const n = Number(panelDrafts[s.id]);
                setQuantity(s.id, n >= 1 ? Math.min(20, n) : pick.quantity);
                setPanelDrafts((d) => {
                  const rest = { ...d };
                  delete rest[s.id];
                  return rest;
                });
              }}
              className={control}
            />
            <p id={"panels-help-" + s.id} className="mt-1.5 text-sm text-muted-foreground">
              1 to 20 panels.
            </p>
          </div>
        )}
        {extras.length > 0 && (
          <fieldset className="ml-6 mt-2 space-y-2 border-l-2 border-primary/40 pl-4">
            <legend className="mb-2 text-sm font-semibold text-foreground">Extras for {s.name}</legend>
            <ul className="space-y-2">{extras.map((a) => renderService(a, true))}</ul>
          </fieldset>
        )}
      </li>
    );
  };

  // W3: categories first; one open at a time, each with its count, starting price and choices.
  const renderCategories = () => {
    const available = bases.filter(offered);
    const hidden = bases.length - available.length;
    const groups = CATEGORY_ORDER.map((category) => ({ category, services: available.filter((s) => s.category === category) })).filter(
      (g) => g.services.length,
    );
    const fromText = (services: ServicePackage[]) => {
      const offers = services.map((s) => ({ s, o: s.offers.find((o) => o.vehicleCategoryId === vehicleId) }));
      const fixed = offers.filter(({ o }) => o?.onlineBooking === "PRICED" && o.unitPriceCentavos !== null).map(({ o }) => o!.unitPriceCentavos!);
      if (fixed.length) return "from " + money(Math.min(...fixed));
      const estimates = offers.map(({ s, o }) => o?.unitPriceCentavos ?? s.referenceUnitPriceCentavos).filter((c): c is number => c !== null);
      return estimates.length ? "from about " + money(Math.min(...estimates)) : "price from the shop";
    };
    return (
      <div className="space-y-3">
        {groups.map(({ category, services }) => {
          const open = openCategory === category;
          const chosen = lines.filter((l) => serviceById(l.serviceId)?.category === category).length;
          const regionId = "category-" + category.toLowerCase();
          return (
            <section key={category} className="rounded border border-input bg-card">
              <h2>
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={regionId}
                  onClick={() => setOpenCategory(open ? null : category)}
                  className="flex min-h-[64px] w-full items-center justify-between gap-3 rounded px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0">
                    <span className="block text-base font-bold text-foreground">{CATEGORY_NAMES[category]}</span>
                    <span className="block text-sm text-muted-foreground">
                      {services.length} {services.length === 1 ? "service" : "services"} · {fromText(services)}
                      {chosen ? <span className="font-semibold text-primary">{" · " + chosen + " chosen"}</span> : null}
                    </span>
                  </span>
                  <ChevronDown aria-hidden="true" className={"h-5 w-5 shrink-0 text-primary transition-transform " + (open ? "rotate-180" : "")} />
                </button>
              </h2>
              <div id={regionId} role="region" aria-label={CATEGORY_NAMES[category]} hidden={!open} className="border-t border-border p-3 sm:p-4">
                {open && <ul className="space-y-3">{services.map((s) => renderService(s))}</ul>}
              </div>
            </section>
          );
        })}
        {hidden > 0 && (
          <p className="text-sm text-muted-foreground">
            {hidden} {hidden === 1 ? "service isn't" : "services aren't"} offered for {vehicle?.name}. Call the shop at {brandConfig.displayPhone} to ask.
          </p>
        )}
      </div>
    );
  };

  const intro = [
    "Prices depend on the size of your vehicle.",
    "Open a category to see its services. You can choose more than one.",
    "Days are in Philippine time. " + arrivalWords(),
    "The shop uses these details to confirm your booking.",
    "",
  ][step - 1];
  const statusWords = booking ? bookingStatusWords(booking.view.status) : "";

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
          <span className="text-center text-sm text-muted-foreground">
            {step < 5 ? `Step ${step} of 4 · ${STEP_LABELS[step - 1]}` : "Booking received"}
          </span>
          {!locked && (
            <Link href="/" aria-label="Cancel and return to home" className="flex min-h-[44px] min-w-[44px] items-center justify-center">
              <X aria-hidden="true" className="h-5 w-5" />
            </Link>
          )}
        </div>
        <div className="h-1 bg-border">
          <div className="h-full bg-primary motion-safe:transition-all" style={{ width: (step < 5 ? step * 25 : 100) + "%" }} />
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-32 pt-8 sm:px-6 sm:pt-14 lg:pb-14">
        <div className="mb-6 max-w-3xl">
          <h1 id="wizard-step-title" tabIndex={-1} className="scroll-mt-28 text-2xl font-bold focus-visible:outline-none sm:text-3xl">
            {HEADINGS[step - 1]}
          </h1>
          {intro && <p className="mt-2 text-base text-muted-foreground">{intro}</p>}
        </div>

        {message && (
          <div ref={errorSummary} tabIndex={-1} role="alert" className="mb-6 rounded border border-destructive p-4 text-sm text-destructive">
            <p className="font-semibold">{message}</p>
            {Object.entries(fieldErrors)
              .filter(([, errors]) => errors.join(" ") !== message)
              .map(([field, errors]) => (
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

        {/* Step 1: vehicle size */}
        {catalog && step === 1 && (
          <div className="max-w-3xl">
            {linkWarning && (
              <div role="alert" className="mb-6 flex items-start justify-between gap-3 rounded border border-warning/50 bg-warning/10 p-4 text-sm text-warning">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <p>{linkWarning}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setLinkWarning("")}
                  aria-label="Dismiss warning"
                  className="-mr-2 -mt-2 inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-warning hover:opacity-80"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            )}
            <fieldset className="space-y-3">
              <legend className="sr-only">Vehicle size</legend>
              {catalog.vehicleCategories.map((v) => {
                const VehicleIcon = getVehicleCategoryIcon(v.code);
                return (
                  <label key={v.id} className={optionCard(vehicleId === v.id) + " min-h-[72px]"}>
                    <div className="flex items-start gap-3.5">
                      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded border border-border bg-[#18181b]">
                        <VehicleIcon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
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
                        setLinkWarning("");
                      }}
                      className="h-5 w-5 shrink-0 accent-primary"
                    />
                  </label>
                );
              })}
            </fieldset>
            <div className="mt-8 hidden items-center justify-end gap-4 lg:flex">{renderPrimary()}</div>
          </div>
        )}

        {/* Steps 2-4: choices beside the summary */}
        {catalog && step >= 2 && step <= 4 && (
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
            <div className="min-w-0 lg:col-span-8">
              {step < 4 && renderMobileSummaryTray()}

              {step === 2 && (
                <div className="space-y-6">
                  {renderCategories()}
                  {quoteState?.key === selectionKey && quoteState.error && (
                    <div role="alert" className="text-sm text-destructive">
                      <p>{quoteState.error}</p>
                      <button type="button" onClick={() => setQuoteVersion((v) => v + 1)} className="mt-2 min-h-[44px] text-sm underline">
                        Retry pricing
                      </button>
                    </div>
                  )}
                </div>
              )}

              {step === 3 && (
                <>
                  {dayNote && (
                    <p role="status" className="mb-4 rounded border border-warning/50 bg-warning/10 p-3 text-sm text-warning">
                      {dayNote}
                    </p>
                  )}
                  <DayPicker
                    data={liveDays?.data ?? null}
                    error={liveDays?.error ?? ""}
                    onRetry={() => setDaysVersion((v) => v + 1)}
                    selected={chosenDay}
                    onSelect={setDay}
                    fromDate={fromDate}
                    onPage={setFromDate}
                    multiDay={multiDay}
                  />
                </>
              )}

              {step === 4 && (
                <form
                  id="booking-details"
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault();
                    void next();
                  }}
                  className={panel}
                >
                  {uncertain && (
                    <p className="mb-6 rounded border border-warning/50 bg-warning/10 p-3 text-sm text-warning">
                      Your submitted details are held unchanged while the confirmation is uncertain. Retry to safely recover your booking request.
                    </p>
                  )}

                  <fieldset disabled={locked} className="space-y-5">
                    <legend className="sr-only">Your details and your vehicle</legend>

                    <div>
                      <div className="flex items-center justify-between">
                        <label htmlFor="customerName" className="text-sm font-semibold text-foreground">
                          Your name
                        </label>
                        {isNameValid && (
                          <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-400">
                            <Check className="h-3.5 w-3.5" aria-hidden="true" /> Looks good
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
                        <p id="customerName-error" className="mt-1.5 text-sm text-destructive">
                          {errorFor("customerName")}
                        </p>
                      )}
                    </div>

                    <div>
                      <div className="flex items-center justify-between">
                        <label htmlFor="customerPhone" className="text-sm font-semibold text-foreground">
                          Philippine mobile number
                        </label>
                        {isPhoneValid && (
                          <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-400">
                            <Check className="h-3.5 w-3.5" aria-hidden="true" /> Looks good
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
                        placeholder="0917 000 0000"
                        aria-invalid={Boolean(errorFor("customerPhone"))}
                        aria-describedby={errorFor("customerPhone") ? "customerPhone-help customerPhone-error" : "customerPhone-help"}
                        className={`${control} ${errorFor("customerPhone") ? "border-destructive ring-1 ring-destructive" : ""}`}
                      />
                      <p id="customerPhone-help" className="mt-1.5 text-sm text-muted-foreground">
                        The shop texts or calls this number about your booking.
                      </p>
                      {errorFor("customerPhone") && (
                        <p id="customerPhone-error" className="mt-1 text-sm text-destructive">
                          {errorFor("customerPhone")}
                        </p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="customerEmail" className="text-sm font-semibold text-foreground">
                        Email address <span className="font-normal text-muted-foreground">(optional)</span>
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
                        <p id="customerEmail-error" className="mt-1.5 text-sm text-destructive">
                          {errorFor("customerEmail")}
                        </p>
                      )}
                    </div>

                    <div>
                      <div className="flex items-center justify-between">
                        <label htmlFor="vehicleModel" className="text-sm font-semibold text-foreground">
                          Vehicle make, model and year
                        </label>
                        {isModelValid && (
                          <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-400">
                            <Check className="h-3.5 w-3.5" aria-hidden="true" /> Looks good
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
                        onChange={(e) => setForm((prev) => ({ ...prev, vehicleModel: e.target.value }))}
                        placeholder="e.g. Toyota Vios 2020"
                        aria-invalid={Boolean(errorFor("vehicleModel"))}
                        aria-describedby={errorFor("vehicleModel") ? "vehicleModel-error" : undefined}
                        className={`${control} ${errorFor("vehicleModel") ? "border-destructive ring-1 ring-destructive" : ""}`}
                      />
                      {errorFor("vehicleModel") && (
                        <p id="vehicleModel-error" className="mt-1.5 text-sm text-destructive">
                          {errorFor("vehicleModel")}
                        </p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="vehiclePlate" className="text-sm font-semibold text-foreground">
                        Plate or conduction number <span className="font-normal text-muted-foreground">(optional)</span>
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
                        placeholder="e.g. ABC 1234"
                        aria-invalid={Boolean(errorFor("vehiclePlate"))}
                        aria-describedby={errorFor("vehiclePlate") ? "vehiclePlate-error" : undefined}
                        className={`${control} ${errorFor("vehiclePlate") ? "border-destructive ring-1 ring-destructive" : ""}`}
                      />
                      {errorFor("vehiclePlate") && (
                        <p id="vehiclePlate-error" className="mt-1.5 text-sm text-destructive">
                          {errorFor("vehiclePlate")}
                        </p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="specialRequests" className="text-sm font-semibold text-foreground">
                        Special requests or paint history <span className="font-normal text-muted-foreground">(optional)</span>
                      </label>
                      <textarea
                        id="specialRequests"
                        name="specialRequests"
                        rows={3}
                        maxLength={1000}
                        enterKeyHint="done"
                        value={form.specialRequests}
                        onChange={(e) => setForm((prev) => ({ ...prev, specialRequests: e.target.value }))}
                        placeholder="Scratches, an earlier coating, interior stains…"
                        aria-invalid={Boolean(errorFor("specialRequests"))}
                        aria-describedby={errorFor("specialRequests") ? "specialRequests-error" : undefined}
                        className={control}
                      />
                      {errorFor("specialRequests") && (
                        <p id="specialRequests-error" className="mt-1.5 text-sm text-destructive">
                          {errorFor("specialRequests")}
                        </p>
                      )}
                    </div>

                    <div id="turnstileToken">
                      <span className="text-sm font-semibold text-foreground">Security check</span>
                      <div className="mt-2">
                        {turnstileSiteKey ? (
                          <TurnstileChallenge
                            key={challenge.version}
                            siteKey={turnstileSiteKey}
                            onToken={onToken}
                            onStatus={onChallengeStatus}
                            size={narrow ? "compact" : "normal"}
                          />
                        ) : (
                          <p className="text-sm text-destructive">
                            Online booking is not available right now. Please call the shop at {brandConfig.displayPhone}.
                          </p>
                        )}
                      </div>
                      {errorFor("turnstileToken") && errorFor("turnstileToken") !== message && (
                        <p className="mt-1.5 text-sm text-destructive">{errorFor("turnstileToken")}</p>
                      )}
                    </div>
                  </fieldset>

                  <div className="mt-8 border-t border-border pt-6 lg:hidden">
                    <h2 className="mb-3 text-base font-bold text-foreground">Check your booking</h2>
                    {renderReview()}
                  </div>
                  <p className="mt-6 text-sm text-muted-foreground">
                    Sending adds your car to that day&apos;s list as a request. The shop reviews it and contacts you to confirm.
                  </p>
                </form>
              )}
            </div>

            {renderSummarySidebar()}
          </div>
        )}

        {/* Step 5: booking received (L10: status and next step, then the private code, then details) */}
        {step === 5 && booking && (
          <div className="max-w-3xl space-y-6">
            <section aria-labelledby="reference-title" className={`${panel} print-receipt-card`}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <ShieldCheck aria-hidden="true" className="h-8 w-8 shrink-0 text-primary" />
                  <div>
                    <p className="text-sm text-muted-foreground">Booking reference</p>
                    <h2 id="reference-title" className="text-2xl font-extrabold tabular-nums tracking-tight text-foreground sm:text-3xl">
                      {booking.view.referenceCode}
                    </h2>
                  </div>
                </div>
                <p className="rounded bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary">{statusWords}</p>
              </div>
              <p className="mt-4 text-base text-foreground">
                {booking.view.status === "CONFIRMED"
                  ? "Your booking is confirmed."
                  : "Your request is sent. The shop will text or call you to confirm."}
              </p>
              <p className="mt-2 text-base text-foreground">
                <strong>{dateLabel(booking.view.bookingDate)}.</strong> {arrivalWords()}
                {booking.multiDay && " This job takes more than one day: this is your drop-off day, and the shop tells you when your car is ready."}
              </p>
              <div className="no-print mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={copyReference}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded border border-input bg-card px-3.5 py-2 text-sm font-semibold text-foreground transition-colors hover:border-primary"
                  aria-label="Copy booking reference"
                >
                  {copied ? (
                    <>
                      <Check className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                      <span className="text-emerald-400">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" aria-hidden="true" />
                      <span>Copy reference</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (typeof window !== "undefined") window.print();
                  }}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded border border-input bg-card px-3.5 py-2 text-sm font-semibold text-foreground transition-colors hover:border-primary"
                >
                  <Printer className="h-4 w-4" aria-hidden="true" />
                  <span>Print receipt</span>
                </button>
              </div>
            </section>

            <ManagementCode referenceCode={booking.view.referenceCode} bookingDate={booking.view.bookingDate} access={booking.access} />

            <section aria-labelledby="details-title" className={`${panel} print-receipt-card`}>
              <h2 id="details-title" className="text-base font-bold text-foreground">
                Booking details
              </h2>
              <dl className="mt-3 divide-y divide-border/60 text-sm">
                <div className="py-3">
                  <dt className="text-muted-foreground">Services</dt>
                  <dd className="mt-0.5 text-foreground">
                    <ul className="space-y-1">
                      {booking.view.lines.map((l) => (
                        <li key={l.serviceId} className="break-words">
                          <span className="font-semibold">
                            {l.name}
                            {l.quantity > 1 ? ` × ${l.quantity}` : ""}
                          </span>{" "}
                          <span className="text-muted-foreground">· {lineAmount(l)}</span>
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
                <div className="py-3">
                  <dt className="text-muted-foreground">Vehicle</dt>
                  <dd className="mt-0.5 break-words text-foreground">
                    {booking.view.vehicleCategoryName} · {booking.vehicleModel}
                    {booking.vehiclePlate ? " · " + booking.vehiclePlate : ""}
                  </dd>
                </div>
                <div className="py-3">
                  <dt className="text-muted-foreground">Your contact</dt>
                  <dd className="mt-0.5 text-foreground">
                    {booking.customerName} · {booking.customerPhone}
                  </dd>
                </div>
                <div className="py-3">
                  <dt className="text-muted-foreground">{quoteTotal(booking.view).label}</dt>
                  <dd className="mt-1 text-2xl font-extrabold tabular-nums text-foreground">{quoteTotal(booking.view).amount}</dd>
                  {quoteTotal(booking.view).note && <p className="mt-0.5 text-sm text-muted-foreground">{quoteTotal(booking.view).note}</p>}
                </div>
                <div className="py-3">
                  <dt className="text-muted-foreground">Shop</dt>
                  <dd className="mt-0.5 text-foreground">
                    {brandConfig.address} ·{" "}
                    <a href={`tel:${brandConfig.contactPhone.replace(/\s+/g, "")}`} className="inline-flex min-h-[44px] items-center font-semibold text-primary hover:underline">
                      {brandConfig.displayPhone}
                    </a>
                  </dd>
                </div>
              </dl>
            </section>

            <details className={`${panel} no-print`}>
              <summary className="flex min-h-[44px] cursor-pointer items-center text-base font-bold text-foreground">
                Paying a deposit (only if the shop asks)
              </summary>
              <div className="mt-4">
                <PaymentInstructions referenceCode={booking.view.referenceCode} />
              </div>
            </details>

            <div className={`${panel} no-print`}>
              <h2 className="text-base font-bold text-foreground">Questions about this booking?</h2>
              <div className="mt-3 flex flex-wrap gap-3">
                <a
                  href={`tel:${brandConfig.contactPhone.replace(/\s+/g, "")}`}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded border border-input bg-card px-4 py-2.5 text-sm font-bold text-foreground transition-colors hover:border-primary"
                >
                  <Phone className="h-4 w-4 text-primary" aria-hidden="true" />
                  Call {brandConfig.displayPhone}
                </a>
                <a
                  href={`${brandConfig.facebookMessengerUrl}?text=${encodeURIComponent(`Hi, I have a question about booking ${booking.view.referenceCode}.`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[44px] items-center gap-2 rounded border border-input bg-card px-4 py-2.5 text-sm font-bold text-foreground transition-colors hover:border-primary"
                >
                  <MessageSquare className="h-4 w-4 text-primary" aria-hidden="true" />
                  Message us on Messenger
                </a>
              </div>
            </div>

            <Link href="/" className="no-print inline-flex min-h-[44px] items-center text-sm font-semibold text-foreground underline-offset-4 hover:underline">
              Return to home
            </Link>
          </div>
        )}
      </main>

      {/* L1: on phones the running total and the main action stay under the thumb. */}
      {step < 5 && (
        <div
          id="wizard-action-bar"
          className="wizard-footer no-print fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 px-4 py-3 backdrop-blur lg:hidden"
        >
          {/* One row: Back, total, action. On phones (below 480 px): total and Back, then the action full width, so the
              total is never squeezed out. */}
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-2">
            <div className="order-2 min-[480px]:order-1">{renderBack()}</div>
            <div className="order-1 min-w-0 flex-1 text-left min-[480px]:order-2 min-[480px]:text-right">{renderTotal()}</div>
            {showPrimary && (
              <div className="order-3 basis-full min-[480px]:basis-auto [&>button]:w-full min-[480px]:[&>button]:w-auto">{renderPrimary()}</div>
            )}
          </div>
          {renderReason()}
        </div>
      )}
    </div>
  );
}
