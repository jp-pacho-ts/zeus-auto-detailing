"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronUp,
  Droplets,
  MessageSquare,
  Plus,
  Phone,
  QrCode,
  ShieldCheck,
  Sparkles,
  Store,
  Wind,
  X,
} from "lucide-react";
import { brandConfig } from "@/config/brand";
import { Logo } from "@/components/ui/logo";
import { Skeleton } from "@/components/ui/skeleton";
import { TurnstileChallenge, type ChallengeStatus } from "@/components/booking/turnstile";
import { DayPicker, DAYS_PER_PAGE, dateLabel, todayInManila } from "@/components/booking/day-picker";
import { BookingTicket } from "@/components/booking/booking-ticket";
import { KioskEndDialog, KioskIdleDialog } from "@/components/booking/kiosk-end-dialog";
import { VehicleDrawing, VehicleDrawingDefs } from "@/components/booking/vehicle-drawing";
import { ManagementCode } from "@/components/booking/management-code";
import { PaymentInstructions } from "@/components/booking/payment-instructions";
import { bookingStatusWords } from "@/components/booking/manage-booking";
import { reveal } from "@/components/booking/reveal";
import { landingPhoto } from "@/components/landing/landing-photos";
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
  splitSizeName,
  selectionLines,
  serviceDetail,
  catalogForBody,
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
  VehicleBodyType,
} from "@/types/catalog-contracts";
import { BODY_TYPES_BY_SIZE, BODY_TYPE_LABEL } from "@/types/catalog-contracts";
import type {
  CreateDayBookingRequest,
  DayAvailabilityData,
  DayAvailabilityResponse,
  DayBookingResponse,
  DayBookingView,
  ManagementAccessGrant,
} from "@/types/contracts";

function getServiceDisciplineIcon(category: string) {
  if (category === "WASH") return Droplets;
  if (category === "DETAILING") return Wind;
  if (category === "GRAPHENE" || category === "REPAINT") return Sparkles;
  return ShieldCheck;
}

const linesQuery = (lines: ServicePick[]) => lines.map((l) => l.serviceId + ":" + l.quantity).join(",");
const BOOKING_HEADERS = { "content-type": "application/json", "x-zeus-booking": "1" };

// P1-52 (LE 2026-11-06): the Manage booking corner family. Fields, buttons and bands are 12 px (rounded-xl), cards 16 px
// (rounded-2xl), chips and the Back and Close controls are pills. Nothing is a 4 px corner.
const control =
  "mt-2 min-h-[52px] w-full rounded-xl border border-input bg-card px-4 py-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60 transition-colors";
// L9: less padding on phones so the security check fits a 320 px screen.
const panel = "rounded-2xl border border-border bg-card p-4 sm:p-8";
const changeLink =
  "inline-flex min-h-[44px] min-w-[44px] items-center justify-end rounded-xl px-2 text-sm font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
// P1-55 (LE): Back is as tall as Continue and Submit: both use this height.
const actionHeight = "min-h-[52px]";
const outlineButton =
  "inline-flex items-center justify-center gap-1 rounded-xl border border-input px-4 text-sm font-semibold text-foreground transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
const pillLink =
  "inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-input text-foreground transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const groupTitle = "mb-4 border-b border-border pb-2 text-sm font-bold text-primary";

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
// Online /book (CEO 2026-11-24): common cars on Philippine roads for each size, so people can tell which size theirs is.
const SIZE_EXAMPLES: Record<string, string> = {
  MOTOR: "e.g. Honda Click, Yamaha NMAX",
  S: "e.g. Toyota Vios, Honda City",
  M: "e.g. Toyota Corolla Cross, Honda HR-V",
  L: "e.g. Toyota Fortuner, Toyota Hilux",
  XL: "e.g. Toyota Land Cruiser, Ford Ranger Raptor, Toyota HiAce",
};
// The normal security-check widget is a fixed 300 px wide; below this it is rendered compact.
const NARROW_QUERY = "(max-width: 359px)";
// Kiosk idle timeout (LE): a booking with no taps or typing for 10 minutes returns to the start; the last minute shows a countdown.
const KIOSK_IDLE_MS = 10 * 60_000;
const KIOSK_WARNING_MS = 60_000;
// Kiosk menu tiles: a service without its own shop photo shows its category's photo.
const KIOSK_CATEGORY_PHOTO: Partial<Record<string, string>> = { WASH: "signature-wash", DETAILING: "full-detailing", GRAPHENE: "arcane-graphene" };

export function BookingWizard({
  initialServiceId,
  initialVehicleName,
  kioskOnExit,
}: {
  initialServiceId?: string;
  initialVehicleName?: string;
  kioskOnExit?: () => void;
}) {
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
  const [step, setStep] = React.useState(1);
  const [rawCatalog, setCatalog] = React.useState<BookingCatalog | null>(null);
  const [catalogError, setCatalogError] = React.useState("");
  const [catalogVersion, setCatalogVersion] = React.useState(0);
  const [vehicleId, setVehicleId] = React.useState("");
  const [bodyType, setBodyType] = React.useState<VehicleBodyType | "">("");
  // L and XL ask which kind of vehicle; a pick-up may have its own price (LE 2026-11-12).
  const catalog = React.useMemo(() => (rawCatalog && catalogForBody(rawCatalog, vehicleId, bodyType)), [rawCatalog, vehicleId, bodyType]);
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
    customerFirstName: "",
    customerLastName: "",
    customerPhone: "",
    customerEmail: "",
    vehicleModel: "",
    vehiclePlate: "",
    specialRequests: "",
    paymentPreference: "WALK_IN",
  });
  const [challenge, setChallenge] = React.useState({ version: 0, token: "" });
  const [challengeStatus, setChallengeStatus] = React.useState<ChallengeStatus>("pending");
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [message, setMessage] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [uncertain, setUncertain] = React.useState(false);
  // The countdown deadline while the idle warning shows; null otherwise.
  const [kioskWarning, setKioskWarning] = React.useState<number | null>(null);
  const [confirmEnd, setConfirmEnd] = React.useState(false);
  // Online: the order opens from the bottom bar as a sheet; it belongs to the step it was opened on, so it closes on the next.
  const [orderOpenAt, setOrderOpenAt] = React.useState(0);
  const orderOpen = orderOpenAt === step;
  const kioskKeepBooking = React.useRef<(() => void) | null>(null);
  // The management code stays in memory only (ADR-002): never in the URL or browser storage.
  const [booking, setBooking] = React.useState<{ view: DayBookingView; access: ManagementAccessGrant | null; vehicleModel: string; vehiclePlate: string | null; customerName: string; customerPhone: string; multiDay: boolean } | null>(null);

  const submitting = React.useRef(false);
  const attempt = React.useRef<CreateDayBookingRequest | null>(null);
  const errorSummary = React.useRef<HTMLDivElement>(null);
  const deepLinkHandled = React.useRef(false);
  const shownStep = React.useRef(step);

  React.useEffect(() => {
    if (!kioskOnExit || pending) return;
    if (step === 5) {
      const timer = window.setTimeout(kioskOnExit, 45_000);
      return () => window.clearTimeout(timer);
    }

    let warning: number;
    let expiration: number;
    let warned = false;
    const renew = () => {
      warned = false;
      setKioskWarning(null);
      window.clearTimeout(warning);
      window.clearTimeout(expiration);
      warning = window.setTimeout(() => {
        warned = true;
        setConfirmEnd(false);
        setKioskWarning(Date.now() + KIOSK_WARNING_MS);
      }, KIOSK_IDLE_MS - KIOSK_WARNING_MS);
      expiration = window.setTimeout(kioskOnExit, KIOSK_IDLE_MS);
    };
    const onActivity = () => {
      if (!warned) renew();
    };
    kioskKeepBooking.current = renew;
    renew();
    window.addEventListener("pointerdown", onActivity);
    window.addEventListener("keydown", onActivity);
    window.addEventListener("input", onActivity);
    return () => {
      window.clearTimeout(warning);
      window.clearTimeout(expiration);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("input", onActivity);
      kioskKeepBooking.current = null;
    };
  }, [kioskOnExit, pending, step]);
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
  const bodyChoices = (vehicle && BODY_TYPES_BY_SIZE[vehicle.code]) ?? [];
  const needsBody = bodyChoices.length > 0 && !bodyType;
  const lines = React.useMemo(
    () => (catalog && vehicleId ? selectionLines(catalog, vehicleId, picks) : []),
    [catalog, vehicleId, picks],
  );
  const selectionKey = vehicleId + "|" + bodyType + "|" + linesQuery(lines);
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
  const fromPrice = (sizeId: string) => {
    const cents = bases.flatMap((s) => s.offers.filter((o) => o.vehicleCategoryId === sizeId && o.onlineBooking === "PRICED" && o.unitPriceCentavos !== null && offerLabel(s, sizeId).bookable).map((o) => o.unitPriceCentavos!));
    return cents.length ? money(Math.min(...cents)) : "";
  };

  // Inline validation checks for Step 4
  const isPhoneValid = /^(09\d{9}|\+639\d{9})$/.test(form.customerPhone.replace(/[\s()\-]/g, ""));
  const isFirstNameValid = form.customerFirstName.trim().length >= 1;
  const isLastNameValid = form.customerLastName.trim().length >= 1;
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
        const query = new URLSearchParams({ vehicleCategoryId: vehicleId, ...(bodyType ? { bodyType } : {}), lines: linesQuery(lines) });
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
  }, [vehicleId, bodyType, lines, selectionKey, step, quoteVersion, uncertain]);

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
        const query = new URLSearchParams({ vehicleCategoryId: vehicleId, ...(bodyType ? { bodyType } : {}), lines: linesQuery(lines), fromDate, days: String(DAYS_PER_PAGE) });
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
  }, [vehicleId, bodyType, lines, fromDate, daysKey, step, daysVersion, uncertain]);

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
      if (needsBody) {
        setMessage("Choose what kind of vehicle it is.");
        return;
      }
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
        signal: kioskOnExit ? AbortSignal.timeout(30_000) : undefined,
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
    (step === 1 && (!vehicleId || needsBody)) ||
    (step === 2 && !lines.length) ||
    (step === 3 && (!day || dayState !== "AVAILABLE")) ||
    (step === 4 && (!challenge.token || (!uncertain && !quote)));
  const showPrimary = step < 5 && !(step === 3 && paused);

  const renderPrimary = () => (
    <button
      type={step === 4 ? "submit" : "button"}
      data-part="primary"
      form={step === 4 ? "booking-details" : undefined}
      onClick={(event) => {
        if (step !== 4) {
          event.preventDefault();
          void next();
        }
      }}
      disabled={primaryDisabled}
      className={actionHeight + " inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 font-bold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"}
    >
      {pending ? "Submitting request…" : step === 4 ? (uncertain ? "Retry same submission" : "Submit booking request") : "Continue"}
      <ArrowRight aria-hidden="true" className="h-4 w-4" />
    </button>
  );
  const renderBack = () =>
    step > 1 && step < 5 ? (
      <button
        type="button"
        data-part="back"
        disabled={locked}
        onClick={() => goTo(step - 1)}
        className={outlineButton + " " + actionHeight}
      >
        <ChevronLeft aria-hidden="true" className="h-4 w-4" />
        Back
      </button>
    ) : null;
  // Kiosk: one running order line (size, services, total), like a counter ordering screen.
  const renderKioskOrder = () => (
    <>
      <span className="block text-xs font-semibold uppercase tracking-[.12em] text-primary">Your order</span>
      {/* On a narrow tablet only the description shortens; the total always shows in full. */}
      <span className="flex min-w-0 items-baseline justify-end gap-3 text-base text-foreground">
        <span className="min-w-0 truncate">
          {[vehicle?.name ?? "Choose a size", lines.length ? `${lines.length} ${lines.length === 1 ? "service" : "services"}` : ""].filter(Boolean).join(" · ")}
        </span>
        {lines.length > 0 && (total
          ? <strong className="shrink-0 text-xl font-extrabold tabular-nums">{total.amount}</strong>
          : <span role="status" className="shrink-0 self-center"><span className="sr-only">Pricing…</span><Skeleton className="h-6 w-24" /></span>)}
      </span>
    </>
  );
  const renderReason = () => (submitReason ? <p className="mt-2 text-sm text-muted-foreground" role="status">{submitReason}</p> : null);

  // The single review, under the details fields (L2, P1-52). Each Change returns to its step.
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
        <dd data-count="" className="text-2xl font-extrabold tabular-nums tracking-tight text-foreground">{total ? total.amount : lines.length ? "Pricing…" : "—"}</dd>
        {total?.note && <p className="mt-1 text-sm text-muted-foreground">{total.note}</p>}
      </div>
    </dl>
  );

  // The day step: what is chosen so far, above the calendar.
  const renderMobileSummaryTray = () => (
    <div className="mb-5 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 rounded-xl border border-border bg-muted px-5 py-2 text-sm [&>p]:col-start-1 [&>button]:col-start-2 [&>button]:row-start-1 [&>button]:row-span-2">
      <p className="font-bold text-foreground">{vehicle?.name}</p>
      <p className="break-words text-muted-foreground">{servicesSummary || "No service chosen yet"}</p>
      {step === 3 && chosenDay && <p className="text-muted-foreground">{dateLabel(chosenDay)}</p>}
      <button type="button" onClick={() => goTo(1)} disabled={locked} className="mt-1 inline-flex min-h-[44px] items-center rounded-xl font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
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

  // W13: the panel count for a picked per-panel service.
  const renderPanels = (s: ServicePackage, pick: { quantity: number }) => (
    <div className={"mt-2 rounded-xl border border-border bg-muted p-4 md:col-span-full"}>
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
  );

  // The menu board: a photo tile per service (tap or click to add or remove), the extras for what is picked, and the order beside it.
  const renderKioskTile = (s: ServicePackage) => {
    const pick = picked(s.id);
    const offer = offerLabel(s, vehicleId, pick?.quantity ?? 1);
    const photo = landingPhoto(s.slug) ?? landingPhoto(KIOSK_CATEGORY_PHOTO[s.category] ?? "");
    const Icon = getServiceDisciplineIcon(s.category);
    const detail = serviceDetail(s);
    return (
      <li key={s.id}>
        <label
          data-part="menu-tile"
          className={
            "relative flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl border transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background " +
            (pick ? "border-primary bg-primary/10 shadow-[inset_0_0_0_1px_rgb(var(--primary))]" : "border-input bg-card hover:border-primary")
          }
        >
          <span className="relative block aspect-[16/10] bg-muted">
            {/* Shows until the photo has loaded and covers it. */}
            {photo && <Skeleton className="absolute inset-0 rounded-none" />}
            {photo ? (
              <Image src={photo.src} alt="" fill sizes="(min-width: 1024px) 22vw, 40vw"
                className={photo.contain ? "object-contain" : "object-cover"} style={photo.position ? { objectPosition: photo.position } : undefined} />
            ) : (
              <span className="grid h-full place-items-center"><Icon className="h-12 w-12 text-primary" aria-hidden="true" /></span>
            )}
          </span>
          <span className="flex flex-1 flex-col gap-1 p-4">
            <span className="text-lg font-bold leading-tight text-foreground">{s.name}</span>
            {detail && <span className="line-clamp-2 text-sm text-muted-foreground">{detail}</span>}
            <span className="mt-auto flex items-center justify-between gap-3 pt-3">
              <span className="text-base font-semibold tabular-nums text-foreground">
                {"compareAtText" in offer && offer.compareAtText && <s className="mr-2 text-xs font-normal text-muted-foreground">{offer.compareAtText}</s>}
                {offer.text}
                {s.unit === "PANEL" ? " · per panel" : ""}
              </span>
              <span aria-hidden="true" data-part="menu-add" className={"grid h-11 w-11 shrink-0 place-items-center rounded-full border " + (pick ? "border-primary bg-primary text-primary-foreground" : "border-input text-foreground")}>
                {pick ? <Check className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
              </span>
            </span>
          </span>
          <input type="checkbox" name="service" value={s.id} checked={Boolean(pick)} disabled={locked} onChange={() => togglePick(s)} className="sr-only" />
        </label>
        {pick && s.unit === "PANEL" && renderPanels(s, pick)}
      </li>
    );
  };

  const renderKioskMenu = () => {
    const available = bases.filter(offered);
    const hidden = bases.length - available.length;
    const groups = CATEGORY_ORDER.map((category) => ({ category, services: available.filter((s) => s.category === category) })).filter((g) => g.services.length);
    const active = groups.find((g) => g.category === openCategory) ?? groups[0];
    const extras = active ? [...new Map(active.services.flatMap(addOnsUnder).map((a) => [a.id, a])).values()] : [];
    return (
      <div className="grid items-start gap-6 md:grid-cols-[180px_minmax(0,1fr)] lg:grid-cols-[190px_minmax(0,1fr)_300px]">
        <nav aria-label="Service categories" className="flex gap-2 overflow-x-auto md:sticky md:top-4 md:flex-col md:overflow-visible">
          {groups.map(({ category }) => {
            const current = active?.category === category;
            const chosen = lines.filter((l) => serviceById(l.serviceId)?.category === category).length;
            return (
              <button key={category} type="button" data-part="menu-category" aria-pressed={current} onClick={() => setOpenCategory(category)}
                className={"flex min-h-[64px] shrink-0 items-center justify-between gap-3 rounded-xl border px-4 text-left font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
                  (current ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card text-foreground hover:border-primary")}>
                {CATEGORY_NAMES[category]}
                {chosen > 0 && <span className={"grid h-7 min-w-7 place-items-center rounded-full px-2 text-sm tabular-nums " + (current ? "bg-primary-foreground text-primary" : "bg-primary text-primary-foreground")}>{chosen}</span>}
              </button>
            );
          })}
        </nav>
        {active && (
          <section aria-labelledby="kiosk-menu-title" className="min-w-0">
            <h2 id="kiosk-menu-title" data-part="menu-title" className="mb-4 text-2xl font-bold text-foreground">{CATEGORY_NAMES[active.category]}</h2>
            <ul className="grid grid-cols-2 gap-4 xl:grid-cols-3">{active.services.map(renderKioskTile)}</ul>
            {extras.length > 0 && (
              <>
                <h3 data-part="menu-title" className="mb-4 mt-8 text-xl font-bold text-foreground">Extras</h3>
                <ul className="grid grid-cols-2 gap-4 xl:grid-cols-3">{extras.map(renderKioskTile)}</ul>
              </>
            )}
            {hidden > 0 && (
              <p className="mt-6 text-sm text-muted-foreground">
                {hidden} {hidden === 1 ? "service isn't" : "services aren't"} offered for {vehicle?.name}. Call the shop at {brandConfig.displayPhone} to ask.
              </p>
            )}
          </section>
        )}
        <aside aria-label="Your order" className="rounded-2xl border border-border bg-card p-5 md:col-span-2 lg:sticky lg:top-4 lg:col-span-1">
          <p className="text-xs font-semibold uppercase tracking-[.12em] text-primary">Your order</p>
          {renderOrderBody()}
          <div className="mt-4 hidden space-y-2 lg:block [&>button]:w-full">{renderPrimary()}{renderBack()}</div>
          <div className="hidden lg:block">{renderReason()}</div>
        </aside>
      </div>
    );
  };

  const renderOrderBody = () => (
    <>
          <div className="mt-2 flex items-center justify-between gap-3 border-b border-border pb-3">
            <p className="font-bold text-foreground">{vehicle?.name}</p>
            <button type="button" onClick={() => goTo(1)} disabled={locked} className={changeLink}>Change size</button>
          </div>
          {lines.length ? (
            <ul className="divide-y divide-border/60">
              {lines.map((l) => {
                const s = serviceById(l.serviceId);
                const priced = quoteLines.find((q) => q.serviceId === l.serviceId);
                return (
                  <li key={l.serviceId} className="flex items-center gap-2 py-3 text-sm">
                    <span className="min-w-0 flex-1 break-words font-semibold text-foreground">{s?.name}{l.quantity > 1 ? ` × ${l.quantity}` : ""}</span>
                    {priced ? <span className="tabular-nums text-muted-foreground">{lineAmount(priced)}</span> : <Skeleton className="h-4 w-16" />}
                    {s && (
                      <button type="button" onClick={() => togglePick(s)} disabled={locked} aria-label={"Remove " + s.name}
                        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <X aria-hidden="true" className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="py-4 text-sm text-muted-foreground">{kioskOnExit ? "Tap a service to add it." : "Choose a service to add it."}</p>
          )}
          <div className="border-t border-border pt-3">
            <p className="text-sm text-muted-foreground">{total?.label ?? "Estimated total"}</p>
            {total || !lines.length ? (
              <p data-count="" className="text-3xl font-extrabold tabular-nums tracking-tight text-foreground">{total ? total.amount : "—"}</p>
            ) : (
              <div role="status" className="py-1.5"><span className="sr-only">Pricing…</span><Skeleton className="h-8 w-40" /></div>
            )}
            {total?.note && <p className="mt-1 text-sm text-muted-foreground">{total.note}</p>}
          </div>
    </>
  );

  const intro = [
    "Prices depend on the size of your vehicle.",
    kioskOnExit ? "Tap a service to add it to your order. You can choose more than one." : "Choose a service to add it to your order. You can choose more than one.",
    arrivalWords(),
    "The shop uses these details to confirm your booking.",
    "",
  ][step - 1];
  const statusWords = booking ? bookingStatusWords(booking.view.status) : "";

  const ticket = booking
    ? {
        referenceCode: booking.view.referenceCode,
        statusWords,
        confirmed: booking.view.status === "CONFIRMED",
        dayLabel: dateLabel(booking.view.bookingDate),
        arrival: arrivalWords(),
        multiDay: booking.multiDay,
        lines: booking.view.lines.map((l) => ({ id: l.serviceId, name: l.name, quantity: l.quantity, amount: lineAmount(l) })),
        vehicle: `${booking.view.vehicleCategoryName} · ${booking.vehicleModel}${booking.vehiclePlate ? " · " + booking.vehiclePlate : ""}`,
        contact: `${booking.customerName} · ${booking.customerPhone}`,
        total: quoteTotal(booking.view),
      }
    : null;

  const printCss = `
        @media print {
          header,
          .no-print,
          .wizard-footer {
            display: none !important;
          }
          .wizard-root, body, main {
            background: #ffffff !important;
            color: #000000 !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          .print-receipt-card {
            border: 1px solid #000000 !important;
            border-radius: 0 !important;
            background: #ffffff !important;
            color: #000000 !important;
            box-shadow: none !important;
            padding: 16px !important;
          }
          .print-receipt-card * {
            color: #000000 !important;
            border-color: #cccccc !important;
          }
          .print-receipt-card [data-part="stub"] {
            background: #ffffff !important;
            padding: 12px 0 0 !important;
          }
          .print-receipt-card [data-part="stub"]::before,
          .print-receipt-card [data-part="stub"]::after {
            display: none !important;
          }
        }
      `;

  const notices = (
    <>
      {message && (
        <div ref={errorSummary} tabIndex={-1} role="alert" className="mb-6 rounded-xl border border-destructive p-4 text-sm text-destructive">
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
        // The vehicle cards as skeletons while the service menu loads.
        <div role="status" aria-busy="true" className="grid grid-cols-2 gap-4 md:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
          <span className="sr-only">Loading the shop service menu…</span>
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} data-part="skeleton-card" className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-3">
              <Skeleton className="h-[clamp(124px,21vh,208px)] rounded-xl" />
              <Skeleton className="mx-1.5 h-5 w-2/3" />
              <Skeleton className="mx-1.5 mb-1.5 h-4 w-1/2" />
            </div>
          ))}
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
    </>
  );

  // The five possible texts of one field: its label with a "Looks good" tick, the input and its error line.
  const tick = (ok: boolean) =>
    ok ? (
      <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-400">
        <Check className="h-3.5 w-3.5" aria-hidden="true" /> Looks good
      </span>
    ) : null;

  return (
    <div className="wizard-root min-h-screen bg-background text-foreground" data-layout={kioskOnExit ? "kiosk" : "online"}>
      <style>{printCss}</style>
      {kioskOnExit && confirmEnd && !pending && step < 5 && <KioskEndDialog onKeep={() => setConfirmEnd(false)} onEnd={() => { setConfirmEnd(false); kioskOnExit(); }} />}
      {kioskOnExit && kioskWarning !== null && !pending && step < 5 && (
        <KioskIdleDialog deadline={kioskWarning} total={KIOSK_WARNING_MS} onKeep={() => kioskKeepBooking.current?.()} onEnd={kioskOnExit} />
      )}

      {step < 5 && (
        <div>
          {/* The booking header (the kiosk ordering screen, LE): logo, the four steps on a gold rail, and End session on the
              kiosk or Close online. The step heading sits under it. */}
          <div data-part="panel" className="no-print">
            <div className="grid grid-cols-2 items-center gap-3 border-b border-border bg-muted px-4 py-3 sm:px-8 lg:grid-cols-[1fr_auto_1fr]">
              {kioskOnExit ? <Logo className="col-start-1 row-start-1" /> : (
                <Link href="/" aria-label="Return to home" className="col-start-1 row-start-1 inline-flex min-h-[44px] items-center justify-self-start rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Logo />
                </Link>
              )}
              <ol aria-label="Booking steps" className="col-span-2 col-start-1 row-start-2 grid grid-cols-4 gap-2 sm:gap-3 lg:col-span-1 lg:col-start-2 lg:row-start-1">
                {STEP_LABELS.map((label, index) => (
                  <li key={label} aria-current={index + 1 === step ? "step" : undefined}
                    className={"flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-2 text-center text-xs font-semibold sm:px-3 sm:text-sm " +
                      (index + 1 === step ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
                    {index + 1 < step ? <Check className="size-4 shrink-0 text-primary" aria-hidden="true" /> : <span data-part="step-number">{index + 1}</span>}
                    {label}
                  </li>
                ))}
              </ol>
              {kioskOnExit && !pending && (
                <button type="button" data-part="end-session" onClick={() => setConfirmEnd(true)} className={pillLink + " col-start-2 row-start-1 justify-self-end px-4 lg:col-start-3"}>
                  End session
                </button>
              )}
              {!kioskOnExit && !locked && (
                <Link href="/" aria-label="Cancel and return to home" className={pillLink + " col-start-2 row-start-1 h-11 w-11 justify-self-end lg:col-start-3"}>
                  <X aria-hidden="true" className="h-5 w-5" />
                </Link>
              )}
            </div>
            <div className="mx-auto max-w-6xl px-4 pb-1 pt-7 sm:px-8 sm:pt-10 lg:pt-[clamp(16px,3vh,40px)]">
              <h1
                key={step}
                id="wizard-step-title"
                tabIndex={-1}
                className="text-balance text-3xl font-extrabold leading-tight tracking-tight focus-visible:outline-none sm:text-5xl"
              >
                {/* Each word rises out of its own mask (React Bits SplitText, in CSS); the spaces stay real text. */}
                {HEADINGS[step - 1].split(" ").map((word, i) => (
                  <React.Fragment key={i}>{i > 0 && " "}<span data-part="title-word" style={{ "--w": i } as React.CSSProperties}><span>{word}</span></span></React.Fragment>
                ))}
              </h1>
              {intro && <p className="mt-2 text-base text-muted-foreground">{intro}</p>}
            </div>
          </div>

          <main className="mx-auto w-full px-4 pb-48 pt-6 sm:px-8 sm:pt-8 lg:pb-28 lg:pt-[clamp(12px,2.5vh,32px)]">
            <div className="mx-auto w-full max-w-[760px] lg:max-w-[1080px]">
              {notices}

              {/* Step 1: vehicle size */}
              {catalog && step === 1 && (
                <div>
                  {linkWarning && (
                    <div role="alert" className="mb-6 flex items-start justify-between gap-3 rounded-xl border border-warning/50 bg-warning/10 p-4 text-sm text-warning">
                      <div className="flex items-start gap-2.5">
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                        <p>{linkWarning}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setLinkWarning("")}
                        aria-label="Dismiss warning"
                        className="-mr-2 -mt-2 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-warning hover:opacity-80"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                  {/* Online /book shows the sizes as words only (CEO 2026-11-24); the kiosk keeps its drawings. */}
                  {kioskOnExit && <VehicleDrawingDefs />}
                  <fieldset>
                    <legend className="sr-only">Vehicle size</legend>
                    {/* The cards share the row on a tablet or laptop (five sizes fit across); phones show two columns. */}
                    <div className="grid grid-cols-2 gap-4 md:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
                      {catalog.vehicleCategories.map((v) => {
                        const name = splitSizeName(v.name);
                        const picked = vehicleId === v.id;
                        const from = fromPrice(v.id);
                        return (
                          <label
                            key={v.id}
                            data-part="vehicle-card"
                            className={
                              "relative flex cursor-pointer flex-col gap-3 rounded-2xl border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background " +
                              // The drawing follows the screen height, so step 1 fits a 650 px laptop screen and still fills a tablet.
                              "[--ic:clamp(64px,12vh,160px)] " +
                              (picked ? "border-primary bg-primary/10 shadow-[inset_0_0_0_1px_rgb(var(--primary))]" : "border-input bg-card hover:border-primary")
                            }
                          >
                            {kioskOnExit && (
                              <span
                                data-part="vehicle-mark"
                                className={
                                  "grid h-[calc(var(--ic)*1.3)] place-items-center rounded-xl " +
                                  (picked ? "bg-[radial-gradient(circle_at_50%_30%,#2b2210,#0d0d0e)]" : "bg-[radial-gradient(circle_at_50%_30%,#1d1a14,#0d0d0e)]")
                                }
                              >
                                <VehicleDrawing code={v.code} className="h-[var(--ic)] w-[var(--ic)]" />
                              </span>
                            )}
                            <span className="block px-1.5 pb-1.5">
                              <span className="block text-base font-extrabold leading-tight text-foreground lg:text-lg">{name.head}</span>
                              {name.tail && (
                                <>
                                  <span className="sr-only"> · </span>
                                  <span className="block text-sm leading-snug text-muted-foreground">{name.tail}</span>
                                </>
                              )}
                              {v.description && <span data-part="vehicle-description" className="block text-sm text-muted-foreground lg:line-clamp-2">{v.description}</span>}
                              {from && <span data-part="vehicle-from" className="mt-2 block text-sm font-semibold tabular-nums text-primary">from {from}</span>}
                              {!kioskOnExit && SIZE_EXAMPLES[v.code] && (
                                <span data-part="vehicle-examples" className="block text-sm text-muted-foreground">{SIZE_EXAMPLES[v.code]}</span>
                              )}
                            </span>
                            <input
                              type="radio"
                              name="vehicle-category"
                              value={v.id}
                              checked={picked}
                              onChange={() => {
                                setVehicleId(v.id);
                                setBodyType("");
                                setLinkWarning("");
                              }}
                              className="absolute right-[22px] top-[22px] h-5 w-5 accent-primary"
                            />
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                  {bodyChoices.length > 0 && (
                    <fieldset className="mt-5">
                      <legend className="text-base font-bold text-foreground">What kind of vehicle?</legend>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {bodyChoices.map((type) => (
                          <label
                            key={type}
                            className={
                              "inline-flex min-h-[44px] cursor-pointer items-center rounded-full border px-5 text-sm font-semibold transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring " +
                              (bodyType === type ? "border-primary bg-primary/10 text-foreground" : "border-input bg-card text-muted-foreground hover:border-primary")
                            }
                          >
                            <input
                              type="radio"
                              name="vehicle-body-type"
                              value={type}
                              checked={bodyType === type}
                              onChange={() => {
                                setBodyType(type);
                                setMessage("");
                              }}
                              className="sr-only"
                            />
                            {vehicle?.code === "XL" && type === "SUV" ? "Full-size SUV" : BODY_TYPE_LABEL[type]}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                </div>
              )}

              {/* Steps 2-4 */}
              {catalog && step >= 2 && step <= 4 && (
                <div className="min-w-0">
                  {step === 3 && renderMobileSummaryTray()}

                  {step === 2 && (
                    <div className="space-y-6">
                      {renderKioskMenu()}
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
                        <p role="status" className="mb-4 rounded-xl border border-warning/50 bg-warning/10 p-3 text-sm text-warning">
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
                      autoComplete={kioskOnExit ? "off" : undefined}
                      noValidate
                      onSubmit={(e) => {
                        e.preventDefault();
                        void next();
                      }}
                    >
                      {uncertain && (
                        <p className="mb-6 rounded-xl border border-warning/50 bg-warning/10 p-3 text-sm text-warning">
                          Your submitted details are held unchanged while the confirmation is uncertain. Retry to safely recover your booking request.
                        </p>
                      )}

                      <fieldset disabled={locked}>
                        <legend className="sr-only">Your details and your vehicle</legend>
                        <div className="space-y-8 lg:grid lg:grid-cols-2 lg:gap-x-[clamp(24px,3vw,48px)] lg:gap-y-8 lg:space-y-0">

                        <div>
                          <h2 className={groupTitle}>About you</h2>
                          <div className="space-y-5">
                            <div className="grid gap-5 sm:grid-cols-2">
                              <div>
                                <div className="flex items-center justify-between">
                                  <label htmlFor="customerFirstName" className="text-sm font-semibold text-foreground">
                                    First name
                                  </label>
                                  {tick(isFirstNameValid)}
                                </div>
                                <input
                                  id="customerFirstName"
                                  name="customerFirstName"
                                  type="text"
                                  autoComplete={kioskOnExit ? "off" : "given-name"}
                                  enterKeyHint="next"
                                  maxLength={50}
                                  value={form.customerFirstName}
                                  onChange={(e) => setForm((prev) => ({ ...prev, customerFirstName: e.target.value }))}
                                  placeholder="e.g. Juan"
                                  aria-invalid={Boolean(errorFor("customerFirstName"))}
                                  aria-describedby={errorFor("customerFirstName") ? "customerFirstName-error" : undefined}
                                  className={`${control} ${errorFor("customerFirstName") ? "border-destructive ring-1 ring-destructive" : ""}`}
                                />
                                {errorFor("customerFirstName") && (
                                  <p id="customerFirstName-error" className="mt-1.5 text-sm text-destructive">
                                    {errorFor("customerFirstName")}
                                  </p>
                                )}
                              </div>
                              <div>
                                <div className="flex items-center justify-between">
                                  <label htmlFor="customerLastName" className="text-sm font-semibold text-foreground">
                                    Last name
                                  </label>
                                  {tick(isLastNameValid)}
                                </div>
                                <input
                                  id="customerLastName"
                                  name="customerLastName"
                                  type="text"
                                  autoComplete={kioskOnExit ? "off" : "family-name"}
                                  enterKeyHint="next"
                                  maxLength={50}
                                  value={form.customerLastName}
                                  onChange={(e) => setForm((prev) => ({ ...prev, customerLastName: e.target.value }))}
                                  placeholder="e.g. dela Cruz"
                                  aria-invalid={Boolean(errorFor("customerLastName"))}
                                  aria-describedby={errorFor("customerLastName") ? "customerLastName-error" : undefined}
                                  className={`${control} ${errorFor("customerLastName") ? "border-destructive ring-1 ring-destructive" : ""}`}
                                />
                                {errorFor("customerLastName") && (
                                  <p id="customerLastName-error" className="mt-1.5 text-sm text-destructive">
                                    {errorFor("customerLastName")}
                                  </p>
                                )}
                              </div>
                            </div>

                            <div>
                              <div className="flex items-center justify-between">
                                <label htmlFor="customerPhone" className="text-sm font-semibold text-foreground">
                                  Philippine mobile number
                                </label>
                                {tick(isPhoneValid)}
                              </div>
                              <input
                                id="customerPhone"
                                name="customerPhone"
                                type="tel"
                                inputMode="tel"
                                autoComplete={kioskOnExit ? "off" : "tel"}
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
                                autoComplete={kioskOnExit ? "off" : "email"}
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
                          </div>
                        </div>

                        <div>
                          <h2 className={groupTitle}>Your vehicle</h2>
                          <div className="space-y-5">
                            <div>
                              <div className="flex items-center justify-between">
                                <label htmlFor="vehicleModel" className="text-sm font-semibold text-foreground">
                                  Vehicle make, model and year
                                </label>
                                {tick(isModelValid)}
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
                              <label className="text-sm font-semibold text-foreground block mb-2">
                                Preferred mode of payment
                              </label>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="radiogroup" aria-label="Preferred mode of payment">
                                <button
                                  type="button"
                                  role="radio"
                                  aria-checked={form.paymentPreference === "WALK_IN"}
                                  onClick={() => setForm((prev) => ({ ...prev, paymentPreference: "WALK_IN" }))}
                                  className={`flex min-h-[56px] items-start gap-3 rounded-xl border p-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                                    form.paymentPreference === "WALK_IN"
                                      ? "border-primary bg-primary/10 shadow-xs"
                                      : "border-border bg-card/60 hover:border-border/90 hover:bg-card"
                                  }`}
                                >
                                  <div
                                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                                      form.paymentPreference === "WALK_IN"
                                        ? "border-primary/40 bg-primary/20 text-primary"
                                        : "border-border/60 bg-muted/40 text-muted-foreground"
                                    }`}
                                  >
                                    <Store className="h-4 w-4" aria-hidden="true" />
                                  </div>
                                  <div>
                                    <span className="block text-sm font-bold text-foreground">Pay at shop</span>
                                    <span className="block text-xs text-muted-foreground mt-0.5">Pay in Cash or Card upon vehicle drop-off / completion</span>
                                  </div>
                                </button>
                                <button
                                  type="button"
                                  role="radio"
                                  aria-checked={form.paymentPreference === "ONLINE_QR"}
                                  onClick={() => setForm((prev) => ({ ...prev, paymentPreference: "ONLINE_QR" }))}
                                  className={`flex min-h-[56px] items-start gap-3 rounded-xl border p-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                                    form.paymentPreference === "ONLINE_QR"
                                      ? "border-primary bg-primary/10 shadow-xs"
                                      : "border-border bg-card/60 hover:border-border/90 hover:bg-card"
                                  }`}
                                >
                                  <div
                                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                                      form.paymentPreference === "ONLINE_QR"
                                        ? "border-primary/40 bg-primary/20 text-primary"
                                        : "border-border/60 bg-muted/40 text-muted-foreground"
                                    }`}
                                  >
                                    <QrCode className="h-4 w-4" aria-hidden="true" />
                                  </div>
                                  <div>
                                    <span className="block text-sm font-bold text-foreground">Online / QR payment</span>
                                    <span className="block text-xs text-muted-foreground mt-0.5">Pay via GCash or GoTyme Bank QR</span>
                                  </div>
                                </button>
                              </div>
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
                          </div>
                        </div>

                        {/* One Submit on this step (LE 2026-11-06, safe default): the review sits under the fields, the security check
                            under the review, and the Submit button is the panel's action (the bar on phones). */}
                        <section data-part="review" aria-labelledby="review-title" className="rounded-2xl border border-border bg-card p-4 sm:p-6">
                          <h2 id="review-title" className="text-base font-bold text-foreground">
                            Check your booking
                          </h2>
                          <p className="mb-4 mt-1 text-sm text-muted-foreground">Look it over. Send it when it is right.</p>
                          {renderReview()}
                        </section>

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
                        </div>
                      </fieldset>

                      <p className="mt-6 text-sm text-muted-foreground">
                        Sending adds your car to that day&apos;s list as a request. The shop reviews it and contacts you to confirm.
                      </p>
                    </form>
                  )}
                </div>
              )}
            </div>
          </main>
        </div>
      )}

      {/* Step 5: booking received (L10), as a ticket like Manage booking: status and next step, then how to manage it, then help */}
      {step === 5 && ticket && booking && (
        <div className="mx-auto max-w-3xl px-4 pb-14 pt-3 sm:px-6">
          <header className="no-print flex items-center justify-between gap-3">
            {kioskOnExit ? <Logo /> : <Link href="/" aria-label="Return to home" className="inline-flex min-h-[44px] items-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Logo />
            </Link>}
          </header>
          <div className="mt-6 flex items-center gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
              <Check aria-hidden="true" className="h-6 w-6" />
            </span>
            <h1 id="wizard-step-title" tabIndex={-1} className="scroll-mt-28 text-balance text-3xl font-extrabold tracking-tight focus-visible:outline-none">
              {HEADINGS[4]}
            </h1>
          </div>
          <div className="mt-6 space-y-6">
            <BookingTicket
              booking={ticket}
              copied={copied}
              onCopy={kioskOnExit ? undefined : copyReference}
              onPrint={kioskOnExit ? undefined : () => {
                if (typeof window !== "undefined") window.print();
              }}
            />

            {!kioskOnExit && <ManagementCode referenceCode={booking.view.referenceCode} bookingDate={booking.view.bookingDate} access={booking.access} />}

            <details className={`${panel} no-print`}>
              <summary className="flex min-h-[44px] cursor-pointer items-center text-base font-bold text-foreground">
                Paying a deposit (only if the shop asks)
              </summary>
              <div className="mt-4">
                <PaymentInstructions referenceCode={booking.view.referenceCode} />
              </div>
            </details>

            {!kioskOnExit && <div className={`${panel} no-print`}>
              <h2 className="text-base font-bold text-foreground">Questions about this booking?</h2>
              <p className="mt-1 text-sm text-muted-foreground">{brandConfig.address}</p>
              <div className="mt-3 flex flex-wrap gap-3">
                <a
                  href={`tel:${brandConfig.contactPhone.replace(/\s+/g, "")}`}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-input bg-card px-4 py-2.5 text-sm font-bold text-foreground transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Phone className="h-4 w-4 text-primary" aria-hidden="true" />
                  Call {brandConfig.displayPhone}
                </a>
                <a
                  href={`${brandConfig.facebookMessengerUrl}?text=${encodeURIComponent(`Hi, I have a question about booking ${booking.view.referenceCode}.`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-input bg-card px-4 py-2.5 text-sm font-bold text-foreground transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <MessageSquare className="h-4 w-4 text-primary" aria-hidden="true" />
                  Message us on Messenger
                </a>
              </div>
            </div>}

            {kioskOnExit ? (
              <button type="button" onClick={kioskOnExit} className={outlineButton + " " + actionHeight}>
                Next customer
              </button>
            ) : <Link href="/" className={outlineButton + " min-h-[44px] no-print"}>
              Return to home
            </Link>}
          </div>
        </div>
      )}

      {/* L1: the running order and the main action stay under the thumb. */}
      {step < 5 && (
        <div
          id="wizard-action-bar"
          className={"wizard-footer no-print fixed inset-x-0 bottom-0 z-20 rounded-t-2xl border-t border-primary/40 bg-muted/95 px-4 py-3 backdrop-blur " + "sm:px-8" + (step === 2 ? " lg:hidden" : "")}
          onKeyDown={(event) => { if (event.key === "Escape" && orderOpen) setOrderOpenAt(0); }}
        >
          {/* Online: the order (each service with its price and a way to remove it) slides up from the bar when asked for. */}
          {!kioskOnExit && orderOpen && lines.length > 0 && (
            <div id="order-sheet" data-part="order-sheet" role="region" aria-label="Your order" className="mx-auto mb-3 max-h-[50vh] max-w-5xl overflow-y-auto border-b border-border pb-3">
              {renderOrderBody()}
            </div>
          )}
          {/* One row: Back, total, action. On phones (below 480 px): total and Back, then the action full width, so the
              total is never squeezed out. */}
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-2">
            <div className="order-2 min-[480px]:order-1">{renderBack()}</div>
            <div className="order-1 min-w-0 flex-1 text-left min-[480px]:order-2 min-[480px]:text-right">
              {kioskOnExit || !lines.length ? renderKioskOrder() : (
                <button type="button" data-part="order-toggle" aria-expanded={orderOpen} aria-controls="order-sheet" onClick={() => setOrderOpenAt(orderOpen ? 0 : step)}
                  className="flex w-full min-w-0 items-center gap-3 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-[480px]:justify-end min-[480px]:text-right">
                  <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-input">
                    <ChevronUp className={"h-4 w-4 transition-transform " + (orderOpen ? "rotate-180" : "")} />
                  </span>
                  <span className="block min-w-0">{renderKioskOrder()}</span>
                </button>
              )}
            </div>
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
