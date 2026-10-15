"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Check, ChevronLeft, ShieldCheck, X } from "lucide-react";
import { brandConfig } from "@/config/brand";
import { formatDuration } from "@/config/catalog";
import { Logo } from "@/components/ui/logo";
import { CreateBookingSchema } from "@/lib/validation";
import { createBookingAction } from "@/server/actions/booking";
import type { AvailableSlotData, AvailableSlotResponse, BookingCatalog, BookingCatalogResponse, BookingSummary, CreateBookingRequest } from "@/types/contracts";

const todayInManila = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const money = (centavos: number) => new Intl.NumberFormat(brandConfig.locale, { style: "currency", currency: "PHP" }).format(centavos / 100);
const dateLabel = (date: string) => new Intl.DateTimeFormat(brandConfig.locale, { dateStyle: "full", timeZone: "Asia/Manila" }).format(new Date(date + "T00:00:00+08:00"));
const timeLabel = (time: string) => new Intl.DateTimeFormat(brandConfig.locale, { hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila" }).format(new Date("2000-01-01T" + time + ":00+08:00"));
const control = "mt-2 min-h-[48px] w-full rounded border border-input bg-card px-4 py-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";
const panel = "rounded border border-border bg-card p-6 sm:p-8";
const vehicleCodes: Record<string, string> = { sedan: "SEDAN", suv: "SUV_CROSSOVER", pickup: "PICKUP_VAN", motorcycle: "MOTORCYCLE_SPECIALTY" };
const serviceAliases: Record<string, string> = { "signature-9h-graphene": "signature-ceramic-coating" };

export function BookingWizard({ initialServiceId, initialVehicleName }: { initialServiceId?: string; initialVehicleName?: string }) {
  const [step, setStep] = React.useState(1);
  const [catalog, setCatalog] = React.useState<BookingCatalog | null>(null);
  const [catalogError, setCatalogError] = React.useState("");
  const [catalogVersion, setCatalogVersion] = React.useState(0);
  const [vehicleId, setVehicleId] = React.useState("");
  const [serviceId, setServiceId] = React.useState("");
  const [date, setDate] = React.useState(todayInManila);
  const [selection, setSelection] = React.useState<{ key: string; time: string } | null>(null);
  const [availability, setAvailability] = React.useState<{ key: string; data: AvailableSlotData | null; error: string } | null>(null);
  const [availabilityVersion, setAvailabilityVersion] = React.useState(0);
  const [form, setForm] = React.useState({ customerName: "", customerPhone: "", customerEmail: "", vehicleModel: "", vehiclePlate: "", specialRequests: "" });
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [message, setMessage] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [uncertain, setUncertain] = React.useState(false);
  const [booking, setBooking] = React.useState<BookingSummary | null>(null);
  const submitting = React.useRef(false);
  const attempt = React.useRef<CreateBookingRequest | null>(null);
  const errorSummary = React.useRef<HTMLDivElement>(null);
  const key = date + "|" + vehicleId + "|" + serviceId;
  const vehicle = catalog?.vehicleCategories.find(v => v.id === vehicleId);
  const service = catalog?.services.find(s => s.id === serviceId);
  const live = availability?.key === key ? availability : null;
  const slot = selection?.key === key ? live?.data?.slots.find(s => s.startTime === selection.time && s.selectable) : undefined;
  const maxDate = new Date(new Date(todayInManila() + "T00:00:00Z").getTime() + 90 * 86400000).toISOString().slice(0, 10);

  React.useEffect(() => {
    const controller = new AbortController();
    fetch("/api/catalog", { cache: "no-store", signal: controller.signal })
      .then(response => response.json()).then((result: BookingCatalogResponse) => {
        if (controller.signal.aborted) return;
        if (!result.ok) throw new Error(result.error.message);
        if (!result.data.vehicleCategories.length || !result.data.services.length) throw new Error("The shop has no bookable services yet. Please contact the studio.");
        const data = result.data;
        setCatalog(data); setCatalogError("");
        setVehicleId(previous => data.vehicleCategories.some(v => v.id === previous) ? previous : (data.vehicleCategories.find(v => v.id === initialVehicleName || v.code === vehicleCodes[initialVehicleName?.toLowerCase() ?? ""] || v.name.toLowerCase() === initialVehicleName?.toLowerCase()) ?? data.vehicleCategories[0]).id);
        setServiceId(previous => data.services.some(s => s.id === previous) ? previous : (data.services.find(s => s.id === initialServiceId || s.slug === (serviceAliases[initialServiceId ?? ""] ?? initialServiceId)) ?? data.services[0]).id);
      }).catch(error => { if (!controller.signal.aborted) setCatalogError(error instanceof Error ? error.message : "The service menu is unavailable. Please retry."); });
    return () => controller.abort();
  }, [initialServiceId, initialVehicleName, catalogVersion]);

  React.useEffect(() => {
    if (!vehicleId || !serviceId || (step !== 3 && step !== 4) || uncertain) return;
    let controller: AbortController | null = null;
    let active = true;
    const refresh = async () => {
      controller?.abort();
      const request = new AbortController(); controller = request;
      try {
        const query = new URLSearchParams({ date, vehicleCategoryId: vehicleId, serviceId });
        const response = await fetch("/api/availability?" + query, { cache: "no-store", signal: request.signal });
        const result: AvailableSlotResponse = await response.json();
        if (!active || request.signal.aborted) return;
        if (!result.ok) { setAvailability({ key, data: null, error: result.error.message }); return; }
        setAvailability({ key, data: result.data, error: "" });
        setSelection(previous => previous?.key === key && !result.data.slots.some(s => s.startTime === previous.time && s.selectable) ? null : previous);
      } catch { if (active && !request.signal.aborted) setAvailability({ key, data: null, error: "Could not refresh availability. Check your connection and retry." }); }
    };
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 15000);
    const focus = () => { void refresh(); };
    window.addEventListener("focus", focus);
    return () => { active = false; controller?.abort(); window.clearInterval(interval); window.removeEventListener("focus", focus); };
  }, [date, vehicleId, serviceId, step, key, availabilityVersion, uncertain]);

  React.useEffect(() => { if (message) errorSummary.current?.focus(); }, [message, fieldErrors]);

  const next = async () => {
    if (submitting.current) return;
    setMessage(""); setFieldErrors({});
    if (step === 1 && vehicle) { setStep(2); return; }
    if (step === 2 && service) { setStep(3); return; }
    if (step === 3) { if (slot) setStep(4); else setMessage("Choose an available arrival time."); return; }
    if (step !== 4) return;
    if (!attempt.current) {
      if (!slot) { setStep(3); setMessage("Availability has changed. Please select an arrival time again."); return; }
      const phone = form.customerPhone.replace(/[ ()-]/g, "");
      const parsed = CreateBookingSchema.safeParse({ ...form, customerPhone: /^9\d{9}$/.test(phone) ? "+63" + phone : form.customerPhone, vehicleCategoryId: vehicleId, serviceId, bookingDate: date, startTime: slot.startTime, idempotencyKey: crypto.randomUUID() });
      if (!parsed.success) {
        const errors: Record<string, string[]> = {};
        for (const issue of parsed.error.issues) (errors[issue.path.join(".") || "form"] ??= []).push(issue.message);
        setFieldErrors(errors); setMessage("Please check the highlighted details."); return;
      }
      attempt.current = parsed.data;
    }
    submitting.current = true; setPending(true);
    try {
      const result = await createBookingAction(attempt.current);
      if (result.ok) { setBooking(result.data); setStep(5); setUncertain(false); attempt.current = null; }
      else {
        setFieldErrors(result.error.fieldErrors); setMessage(result.error.message);
        setUncertain(result.error.retryable);
        if (!result.error.retryable) attempt.current = null;
        if (result.error.code === "SLOT_UNAVAILABLE" || result.error.code === "SCHEDULE_CONFLICT") { setSelection(null); setStep(3); setAvailabilityVersion(v => v + 1); }
        if (result.error.code === "NOT_FOUND") { setStep(result.error.fieldErrors.vehicleCategoryId ? 1 : 2); setCatalogVersion(v => v + 1); }
      }
    } catch {
      setUncertain(true);
      setMessage("The result could not be confirmed. Retry this same submission to recover your booking safely.");
    } finally { submitting.current = false; setPending(false); }
  };
  const retryCatalog = () => { setCatalogError(""); setCatalogVersion(v => v + 1); };
  const locked = pending || uncertain;
  const errorFor = (field: string) => fieldErrors[field]?.join(" ");
  const headings = ["Select your vehicle classification.", "Choose your treatment package.", "Select arrival date and bay schedule.", "Vehicle and contact details.", "Booking received."];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-20 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" aria-label="Return to home"><Logo /></Link>
          <span className="text-sm text-muted-foreground">Step {step} of 5</span>
          {!locked && <Link href="/" aria-label="Cancel and return to home" className="flex min-h-[44px] min-w-[44px] items-center justify-center"><X aria-hidden="true" className="h-5 w-5" /></Link>}
        </div>
        <div className="h-1 bg-border"><div className="h-full bg-primary motion-safe:transition-all" style={{ width: (step * 20) + "%" }} /></div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        <h1 className="mb-3 text-2xl font-bold sm:text-3xl">{headings[step - 1]}</h1>
        <p className="mb-8 text-sm text-muted-foreground">Appointment times are shown in Asia/Manila (UTC+8). One bay is reserved for the full service duration.</p>
        {message && <div ref={errorSummary} tabIndex={-1} role="alert" className="mb-6 rounded border border-destructive p-4 text-sm text-destructive">
          <p>{message}</p>
          {Object.entries(fieldErrors).map(([field, errors]) => <p key={field}><a className="underline" href={step === 4 ? "#" + field : "#arrival-date"}>{errors.join(" ")}</a></p>)}
        </div>}
        {!catalog && !catalogError && <div role="status" className={panel}>Loading the shop service menu…</div>}
        {catalogError && <div role="alert" className={panel}><p>{catalogError}</p><button type="button" onClick={retryCatalog} className="mt-4 min-h-[44px] underline">Retry service menu</button></div>}

        {catalog && step === 1 && <fieldset className="space-y-3"><legend className="mb-3 text-sm text-muted-foreground">Choose one vehicle category.</legend>{catalog.vehicleCategories.map(v => <label key={v.id} className={panel + " flex min-h-[80px] cursor-pointer items-center justify-between gap-4 " + (vehicleId === v.id ? "border-primary" : "")}>
          <span><span className="block font-bold">{v.name}</span><span className="text-sm text-muted-foreground">{v.description}</span><span className="mt-2 block text-sm text-primary">{v.sizeMultiplier}× service price</span></span>
          <input type="radio" name="vehicle-category" value={v.id} checked={vehicleId === v.id} onChange={() => { setVehicleId(v.id); setSelection(null); }} className="h-5 w-5 accent-primary" />
        </label>)}</fieldset>}

        {catalog && step === 2 && <fieldset className="space-y-3"><legend className="mb-3 text-sm text-muted-foreground">Choose one active treatment package.</legend>{catalog.services.map(s => <label key={s.id} className={panel + " flex min-h-[110px] cursor-pointer items-center justify-between gap-4 " + (serviceId === s.id ? "border-primary" : "")}>
          <span><span className="block font-bold">{s.name}</span><span className="mt-1 block text-sm text-muted-foreground">{s.description}</span><span className="mt-3 block text-sm">{formatDuration(s.durationMinutes)} · {money(Math.round(s.basePriceCentavos * (vehicle?.sizeMultiplier ?? 1)))}</span></span>
          <input type="radio" name="service" value={s.id} checked={serviceId === s.id} onChange={() => { setServiceId(s.id); setSelection(null); }} className="h-5 w-5 shrink-0 accent-primary" />
        </label>)}</fieldset>}

        {catalog && step === 3 && <div className="space-y-6">
          <div className={panel}><label htmlFor="arrival-date" className="font-semibold">Arrival date</label><input id="arrival-date" type="date" min={todayInManila()} max={maxDate} value={date} onChange={e => { setDate(e.target.value); setSelection(null); }} className={control} /><p className="mt-2 text-sm text-muted-foreground">Choose today through the next 90 days. Opening hours and closures are checked live.</p></div>
          <section aria-labelledby="slots-title" aria-busy={!live} className={panel}>
            <h2 id="slots-title" className="text-lg font-bold">Available arrival slots</h2><p className="mt-1 text-sm text-muted-foreground">{date ? dateLabel(date) : "Choose a date"}</p>
            {!live && <div role="status" className="mt-4 grid grid-cols-2 gap-3"><span className="sr-only">Loading bay availability</span>{[0, 1, 2, 3].map(i => <div key={i} className="h-16 rounded bg-muted motion-safe:animate-pulse" />)}</div>}
            {live?.error && <div role="alert" className="mt-4"><p>{live.error}</p><button type="button" onClick={() => setAvailabilityVersion(v => v + 1)} className="min-h-[44px] underline">Retry availability</button></div>}
            {live?.data && <><p role="status" aria-live="polite" className="my-4 text-sm text-muted-foreground">{live.data.reason || (live.data.slots.some(s => s.selectable) ? "Availability refreshed for the full service duration." : "No arrival times remain for this service on this date.")}</p>
              <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2"><legend className="sr-only">Available arrival slots</legend>{live.data.slots.map(s => <label key={s.slotId} className={"flex min-h-[64px] items-center justify-between gap-3 rounded border px-4 py-3 " + (!s.selectable ? "cursor-not-allowed border-border opacity-60" : selection?.key === key && selection.time === s.startTime ? "border-primary bg-primary/10" : "cursor-pointer border-input")}>
                <span><span className="block font-semibold">{timeLabel(s.startTime)}</span><span className="block text-sm text-muted-foreground">{s.selectable ? s.remainingCapacity === 1 ? "1 Bay Left" : s.remainingCapacity + " Bays Open" : s.state === "SOLD_OUT" ? "Sold Out" : s.reason}</span></span>
                <input type="radio" name="arrival-time" aria-label={timeLabel(s.startTime) + " — " + (s.selectable ? s.remainingCapacity + " bays available" : s.reason)} checked={selection?.key === key && selection.time === s.startTime} disabled={!s.selectable} onChange={() => setSelection({ key, time: s.startTime })} className="h-5 w-5 shrink-0 accent-primary" />
              </label>)}</fieldset>
              <p className="mt-4 text-sm text-muted-foreground">{formatDuration(live.data.durationMinutes)} · Estimated total {money(live.data.totalPriceCentavos)}. The committed booking summary contains the final quote.</p>
            </>}
          </section>
        </div>}

        {catalog && step === 4 && <form id="booking-details" onSubmit={e => { e.preventDefault(); void next(); }} className={panel}>
          <p className="mb-6 text-sm text-muted-foreground">{service?.name} · {dateLabel(date)} · {slot ? timeLabel(slot.startTime) : "Arrival time needs review"}</p>
          {uncertain && <p className="mb-6 text-sm text-warning">Your submitted details are held unchanged while the result is uncertain. Retry to recover the original booking safely.</p>}
          <fieldset disabled={locked} className="space-y-5"><legend className="sr-only">Customer and vehicle details</legend>
            {([
              ["customerName", "Full customer name", "text", "name", 100],
              ["customerPhone", "Philippine mobile number", "tel", "tel", 32],
              ["customerEmail", "Email address (optional)", "email", "email", 254],
              ["vehicleModel", "Vehicle make, model and year", "text", "off", 100],
              ["vehiclePlate", "Plate or conduction number (optional)", "text", "off", 20],
            ] as const).map(([field, label, type, autoComplete, maxLength]) => <div key={field}>
              <label htmlFor={field} className="text-sm font-semibold">{label}</label><input id={field} name={field} type={type} autoComplete={autoComplete} maxLength={maxLength} value={form[field]} onChange={e => setForm(previous => ({ ...previous, [field]: e.target.value }))} placeholder={field === "customerPhone" ? brandConfig.displayPhone : undefined} aria-invalid={Boolean(errorFor(field))} aria-describedby={errorFor(field) ? field + "-error" : undefined} className={control} />
              {errorFor(field) && <p id={field + "-error"} className="mt-1 text-sm text-destructive">{errorFor(field)}</p>}
            </div>)}
            <div><label htmlFor="specialRequests" className="text-sm font-semibold">Special requests (optional)</label><textarea id="specialRequests" name="specialRequests" rows={3} maxLength={1000} value={form.specialRequests} onChange={e => setForm(previous => ({ ...previous, specialRequests: e.target.value }))} aria-invalid={Boolean(errorFor("specialRequests"))} aria-describedby={errorFor("specialRequests") ? "specialRequests-error" : undefined} className={control} />{errorFor("specialRequests") && <p id="specialRequests-error" className="text-sm text-destructive">{errorFor("specialRequests")}</p>}</div>
          </fieldset>
        </form>}

        {step === 5 && booking && <section aria-labelledby="reference-title" className={panel}>
          <ShieldCheck aria-hidden="true" className="mb-4 h-10 w-10 text-primary" /><p className="text-sm font-semibold text-primary">Booking received · {booking.status === "PENDING" ? "Pending shop review" : booking.status}</p><h2 id="reference-title" className="mt-2 text-2xl font-bold tabular-nums">{booking.referenceCode}</h2>
          <dl className="mt-6 space-y-4 text-sm"><div><dt className="text-muted-foreground">Appointment</dt><dd className="font-semibold">{dateLabel(booking.bookingDate)} · {timeLabel(booking.startTime)}–{timeLabel(booking.endTime)} · {booking.timezone}</dd></div><div><dt className="text-muted-foreground">Treatment</dt><dd>{booking.serviceName} · {formatDuration(booking.durationMinutes)}</dd></div><div><dt className="text-muted-foreground">Vehicle</dt><dd>{booking.vehicleCategoryName} · {booking.vehicleModel}{booking.vehiclePlate ? " · " + booking.vehiclePlate : ""}</dd></div><div><dt className="text-muted-foreground">Customer</dt><dd>{booking.customerName} · {booking.customerPhone}</dd></div><div><dt className="text-muted-foreground">Committed quote</dt><dd className="text-xl font-bold">{money(booking.totalPriceCentavos)}</dd></div></dl>
          <p className="mt-6 text-sm text-muted-foreground">Keep this reference for arrival. Your reservation is saved; shop confirmation is still pending.</p>
        </section>}

        <div className="mt-8 flex items-center justify-between gap-4">
          {step > 1 && step < 5 ? <button type="button" disabled={locked} onClick={() => { setStep(s => s - 1); setMessage(""); setFieldErrors({}); }} className="inline-flex min-h-[44px] items-center gap-2 px-4 disabled:opacity-50"><ChevronLeft aria-hidden="true" className="h-4 w-4" />Back</button> : <span />}
          {step < 5 ? <button type={step === 4 ? "submit" : "button"} form={step === 4 ? "booking-details" : undefined} onClick={event => { event.preventDefault(); void next(); }} disabled={pending || !catalog || Boolean(catalogError) || (step === 3 && !slot)} className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded bg-primary px-6 py-3 font-bold text-primary-foreground hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50">{pending ? "Saving reservation…" : step === 4 ? uncertain ? "Retry same submission" : "Submit reservation" : "Continue"}<ArrowRight aria-hidden="true" className="h-4 w-4" /></button> : <Link href="/" className="inline-flex min-h-[48px] items-center gap-2 rounded bg-primary px-6 py-3 font-bold text-primary-foreground">Return to studio home<Check aria-hidden="true" className="h-4 w-4" /></Link>}
        </div>
      </main>
    </div>
  );
}
