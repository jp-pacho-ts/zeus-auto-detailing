"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DayPicker, DAYS_PER_PAGE, dateLabel, todayInManila } from "@/components/booking/day-picker";
import {
  CATEGORY_NAMES,
  CATEGORY_ORDER,
  availableAddOns,
  catalogForBody,
  createAdminDayRequest,
  isMultiDay,
  lineAmount,
  offerLabel,
  quoteTotal,
  selectionLines,
  type DetailsForm,
  type ServicePick,
} from "@/components/booking/day-booking";
import { BODY_TYPES_BY_SIZE, BODY_TYPE_LABEL, type BookingCatalog, type ServicePackage, type VehicleBodyType } from "@/types/catalog-contracts";
import type { DayAvailabilityData, DayAvailabilityResponse, DayBookingView } from "@/types/contracts";
import { adminRequest, AdminRequestError } from "./client";
import { nextKey, pickerData } from "./new-booking-model";

// Walk-in and phone bookings (2026-11-27): the admin enters the booking for the customer. Same catalog, prices, days and
// rules as /book; the server skips only the online checks. Saved as PENDING; Confirm and the deposit stay on the board.
export function NewBookingDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (booking: DayBookingView) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} labelledBy="new-booking-title" className="max-w-[1040px] p-0">
      {/* Mounted only while open, so a closed dialog keeps no customer details. */}
      <NewBookingForm onCancel={() => onOpenChange(false)} onCreated={onCreated} />
    </Dialog>
  );
}

const label = "block text-xs font-semibold text-muted-foreground";
const legend = "mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground";
const linesQuery = (lines: ServicePick[]) => lines.map((l) => l.serviceId + ":" + l.quantity).join(",");
const EMPTY: DetailsForm = { customerFirstName: "", customerLastName: "", customerPhone: "", customerEmail: "", vehicleModel: "", vehiclePlate: "", specialRequests: "" };

function NewBookingForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (booking: DayBookingView) => void }) {
  const [rawCatalog, setCatalog] = React.useState<BookingCatalog | null>(null);
  const [catalogError, setCatalogError] = React.useState("");
  const [vehicleId, setVehicleId] = React.useState("");
  const [bodyType, setBodyType] = React.useState<VehicleBodyType | "">("");
  const [picks, setPicks] = React.useState<ServicePick[]>([]);
  const [fromDate, setFromDate] = React.useState(todayInManila);
  const [day, setDay] = React.useState("");
  const [days, setDays] = React.useState<{ key: string; data: DayAvailabilityData | null; error: string } | null>(null);
  const [daysVersion, setDaysVersion] = React.useState(0);
  const [form, setForm] = React.useState<DetailsForm>(EMPTY);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});
  const [message, setMessage] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [key, setKey] = React.useState(() => crypto.randomUUID());

  React.useEffect(() => {
    const controller = new AbortController();
    adminRequest<BookingCatalog>("/api/catalog", { signal: controller.signal })
      .then(setCatalog)
      .catch((e) => !controller.signal.aborted && setCatalogError(e instanceof Error ? e.message : "The service list is unavailable."));
    return () => controller.abort();
  }, []);

  const catalog = React.useMemo(() => rawCatalog && catalogForBody(rawCatalog, vehicleId, bodyType), [rawCatalog, vehicleId, bodyType]);
  const vehicle = catalog?.vehicleCategories.find((v) => v.id === vehicleId);
  const bodyChoices = (vehicle && BODY_TYPES_BY_SIZE[vehicle.code]) ?? [];
  const needsBody = bodyChoices.length > 0 && !bodyType;
  const lines = React.useMemo(() => (catalog && vehicleId ? selectionLines(catalog, vehicleId, picks) : []), [catalog, vehicleId, picks]);
  const serviceById = (id: string) => catalog?.services.find((s) => s.id === id);
  const hasBase = lines.some((l) => serviceById(l.serviceId)?.type === "BASE");
  const daysKey = [vehicleId, bodyType, linesQuery(lines), fromDate].join("|");
  const liveDays = days?.key === daysKey ? days : null;
  const quote = liveDays?.data?.quote ?? null;
  const dayState = liveDays?.data?.days.find((d) => d.date === day)?.state;
  const chosenDay = dayState === "AVAILABLE" ? day : "";

  // Days and the server-signed quote for this selection, the same call /book makes.
  React.useEffect(() => {
    if (!vehicleId || needsBody || !hasBase) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ vehicleCategoryId: vehicleId, ...(bodyType ? { bodyType } : {}), lines: linesQuery(lines), fromDate, days: String(DAYS_PER_PAGE) });
    fetch("/api/availability?" + query, { cache: "no-store", signal: controller.signal })
      .then((r) => r.json() as Promise<DayAvailabilityResponse>)
      .then((r) => setDays({ key: daysKey, data: r.ok ? r.data : null, error: r.ok ? "" : r.error.message }))
      .catch(() => !controller.signal.aborted && setDays({ key: daysKey, data: null, error: "Could not load the days. Check the connection and retry." }));
    return () => controller.abort();
  }, [vehicleId, bodyType, needsBody, hasBase, lines, fromDate, daysKey, daysVersion]);

  const set = (field: keyof DetailsForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const error = (field: string) => fieldErrors[field]?.[0];
  const described = (field: string) => (error(field) ? { "aria-invalid": true, "aria-describedby": "nb-" + field + "-error" } : {});
  const errorText = (field: string) => error(field) && <p id={"nb-" + field + "-error"} className="mt-1 text-xs text-rose-400">{error(field)}</p>;

  // Bookable main services for this size, then add-ons that fit a chosen main service; nothing already picked.
  const offered = (s: ServicePackage) => Boolean(vehicleId) && offerLabel(s, vehicleId).bookable && !picks.some((p) => p.serviceId === s.id);
  const bases = catalog?.services.filter((s) => s.type === "BASE" && offered(s)) ?? [];
  const addOns = catalog ? availableAddOns(catalog, lines.map((l) => l.serviceId)).filter(offered) : [];

  async function save() {
    setFieldErrors({});
    setMessage("");
    if (!quote || !chosenDay) {
      setMessage(!hasBase ? "Choose at least one main service." : "Choose an available day.");
      return;
    }
    const built = createAdminDayRequest({ form, quote, bookingDate: chosenDay, idempotencyKey: key });
    if (!built.ok) {
      setFieldErrors(built.fieldErrors);
      setMessage("Please check the highlighted details.");
      return;
    }
    setPending(true);
    try {
      const result = await adminRequest<{ booking: DayBookingView; replayed: boolean }>("/api/admin/bookings", { method: "POST", body: built.data });
      onCreated(result.booking);
    } catch (e) {
      setKey((k) => nextKey(e, k, () => crypto.randomUUID()));
      if (e instanceof AdminRequestError) {
        setFieldErrors(e.fieldErrors);
        setMessage(e.message);
        if (e.fieldErrors.bookingDate || e.detail.code === "CATALOG_UPDATED") setDaysVersion((v) => v + 1);
      } else setMessage("The shop server didn't answer. Check the connection and save again.");
    } finally {
      setPending(false);
    }
  }

  const total = quote ? quoteTotal(quote) : null;
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="relative p-6 pb-3">
        <DialogHeader>
          <DialogTitle id="new-booking-title">New booking</DialogTitle>
          <DialogDescription>For walk-ins and phone bookings. Saved as Pending; confirm it and mark the deposit on the board.</DialogDescription>
        </DialogHeader>
        {message && (
          <p role="alert" className="mt-3 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
            {message}
          </p>
        )}
        {catalogError && <p role="alert" className="mt-3 text-sm text-rose-400">{catalogError}</p>}
      </div>

      <div className="grid gap-6 px-6 pb-4 lg:grid-cols-2">
        <div className="space-y-5">
          <fieldset>
            <legend className={legend}>Customer</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={label}>First name
                <Input className="mt-1" autoComplete="off" value={form.customerFirstName} onChange={set("customerFirstName")} {...described("customerFirstName")} />
                {errorText("customerFirstName")}
              </label>
              <label className={label}>Last name
                <Input className="mt-1" autoComplete="off" value={form.customerLastName} onChange={set("customerLastName")} {...described("customerLastName")} />
                {errorText("customerLastName")}
              </label>
              <label className={label}>Phone
                <Input className="mt-1" type="tel" inputMode="tel" autoComplete="off" placeholder="0917 000 0000" value={form.customerPhone} onChange={set("customerPhone")} {...described("customerPhone")} />
                {errorText("customerPhone")}
              </label>
              <label className={label}>Email <span className="font-normal">(optional)</span>
                <Input className="mt-1" type="email" autoComplete="off" placeholder="For the confirmation email" value={form.customerEmail} onChange={set("customerEmail")} {...described("customerEmail")} />
                {errorText("customerEmail")}
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend className={legend}>Vehicle</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className={label}>Size
                <Select className="mt-1" value={vehicleId} onChange={(e) => { setVehicleId(e.target.value); setBodyType(""); }} disabled={!catalog}>
                  <option value="">Choose…</option>
                  {catalog?.vehicleCategories.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </Select>
              </label>
              <label className={label}>Model
                <Input className="mt-1" autoComplete="off" placeholder="Toyota Vios" value={form.vehicleModel} onChange={set("vehicleModel")} {...described("vehicleModel")} />
                {errorText("vehicleModel")}
              </label>
              <label className={label}>Plate <span className="font-normal">(optional)</span>
                <Input className="mt-1" autoComplete="off" value={form.vehiclePlate} onChange={set("vehiclePlate")} {...described("vehiclePlate")} />
                {errorText("vehiclePlate")}
              </label>
              {bodyChoices.length > 0 && (
                <label className={label}>Kind of vehicle
                  <Select className="mt-1" value={bodyType} onChange={(e) => setBodyType(e.target.value as VehicleBodyType | "")}>
                    <option value="">Choose…</option>
                    {bodyChoices.map((b) => <option key={b} value={b}>{BODY_TYPE_LABEL[b]}</option>)}
                  </Select>
                </label>
              )}
            </div>
          </fieldset>

          <fieldset>
            <legend className={legend}>Services</legend>
            <div className="overflow-hidden rounded-lg border border-border">
              {lines.map((l) => {
                const s = serviceById(l.serviceId)!, priced = quote?.lines.find((q) => q.serviceId === l.serviceId);
                return (
                  <div key={l.serviceId} className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-sm">
                    <span className="min-w-0">
                      {s.name}
                      {s.type === "ADD_ON" && <span className="text-muted-foreground"> · add-on</span>}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {s.unit === "PANEL" && (
                        <Input
                          aria-label={`${s.name} panels`}
                          type="number"
                          min={1}
                          max={20}
                          className="w-[72px]"
                          value={l.quantity}
                          onChange={(e) => setPicks((p) => p.map((x) => (x.serviceId === s.id ? { ...x, quantity: Number(e.target.value) } : x)))}
                        />
                      )}
                      <span className="tabular-nums">{priced ? lineAmount(priced) : "…"}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${s.name}`}
                        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        onClick={() => setPicks((p) => p.filter((x) => x.serviceId !== s.id))}
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </span>
                  </div>
                );
              })}
              <div className="p-2">
                <Select
                  aria-label="Add service"
                  value=""
                  disabled={!vehicleId || needsBody}
                  onChange={(e) => e.target.value && setPicks((p) => [...p, { serviceId: e.target.value, quantity: 1 }])}
                >
                  <option value="">{!vehicleId ? "Choose the size first" : needsBody ? "Choose the kind of vehicle first" : "+ Add service"}</option>
                  {CATEGORY_ORDER.map((c) => {
                    const group = bases.filter((s) => s.category === c);
                    return group.length ? (
                      <optgroup key={c} label={CATEGORY_NAMES[c]}>
                        {group.map((s) => <option key={s.id} value={s.id}>{s.name} · {offerLabel(s, vehicleId).text}</option>)}
                      </optgroup>
                    ) : null;
                  })}
                  {addOns.length > 0 && (
                    <optgroup label="Add-ons">
                      {addOns.map((s) => <option key={s.id} value={s.id}>{s.name} · {offerLabel(s, vehicleId).text}</option>)}
                    </optgroup>
                  )}
                </Select>
              </div>
              {total && (
                <div className="flex items-center justify-between bg-white/5 px-3 py-2 text-sm font-bold">
                  <span>{total.label}</span>
                  <span className="tabular-nums">{total.amount}</span>
                </div>
              )}
            </div>
            {total?.note && <p className="mt-1 text-xs text-muted-foreground">{total.note}</p>}
          </fieldset>

          <label className={label}>Notes <span className="font-normal">(optional)</span>
            <textarea
              rows={2}
              maxLength={1000}
              value={form.specialRequests}
              onChange={set("specialRequests")}
              className="mt-1 w-full rounded-md border border-border bg-[#0d0d0f] px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            />
          </label>
        </div>

        <fieldset>
          <legend className={legend}>Day</legend>
          {hasBase && !needsBody ? (
            <DayPicker
              data={pickerData(liveDays?.data ?? null)}
              error={liveDays?.error ?? ""}
              onRetry={() => setDaysVersion((v) => v + 1)}
              selected={chosenDay}
              onSelect={setDay}
              fromDate={fromDate}
              onPage={setFromDate}
              multiDay={catalog ? isMultiDay(catalog, lines.map((l) => l.serviceId)) : false}
              notice="Choosing a day doesn't hold a place. The place is set when you save."
            />
          ) : (
            <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">Choose the vehicle size and a main service to see the days.</p>
          )}
          {errorText("bookingDate")}
        </fieldset>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-4">
        <p className="text-xs text-muted-foreground">{chosenDay ? `Saved as Pending in ${dateLabel(chosenDay)}'s queue` : "Saved as Pending"}</p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="min-h-[44px]" onClick={onCancel} disabled={pending}>Cancel</Button>
          <Button type="submit" className="min-h-[44px]" disabled={pending || !catalog}>{pending ? "Saving…" : "Save booking"}</Button>
        </div>
      </div>
    </form>
  );
}
