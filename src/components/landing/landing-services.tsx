"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Check, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { BookingCatalog, BookingQuote, CatalogSelection, ServicePackage, VehicleBodyType } from "@/types/catalog-contracts";
import { BODY_TYPES_BY_SIZE, BODY_TYPE_LABEL, MAX_SELECTION_LINES } from "@/types/catalog-contracts";
import { brandConfig } from "@/config/brand";
import type { LandingStatus } from "@/server/landing/status";
import { bookingAction, bookingHref, estimateLabels, money, pruneSelection, quoteFailure, selectionKey, serviceArrow, servicePrice, type QuoteAnswer } from "./landing-model";
import { LandingCard } from "./landing-card";

export type DisplayCatalog = Omit<BookingCatalog, "catalogReleaseId" | "catalogVersion">;
const CATEGORIES = ["WASH", "DETAILING", "GRAPHENE", "TINT", "PPF", "REPAINT"] as const;
const LABELS = { WASH: "Wash", DETAILING: "Detailing", GRAPHENE: "Graphene", TINT: "Tint", PPF: "PPF", REPAINT: "Repaint" };
const subscribe = () => () => {};
// Public fields only; no signed token/release/queue or server quote object is retained in state.
type Estimate = Pick<BookingQuote, "lines" | "totalPriceCentavos" | "estimatedTotalCentavos">;
export function LandingServices({ catalog, phone, messenger, status }: { catalog: DisplayCatalog; phone: string; messenger: string; status: LandingStatus }) {
  const enhanced = useSyncExternalStore(subscribe, () => true, () => false);
  const [category, setCategory] = useState<string>("WASH");
  const [sizeId, setSizeId] = useState("");
  const [body, setBody] = useState<VehicleBodyType | undefined>();
  const [lines, setLines] = useState<CatalogSelection["lines"]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [result, setResult] = useState<{ key: string; revision: number; vehicle: string; quote: Estimate } | null>(null);
  const active = useRef<AbortController | null>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const revision = useRef(0);
  const [version, setVersion] = useState(0);
  const booking = bookingAction(status, phone);
  const size = catalog.vehicleCategories.find((s) => s.id === sizeId);
  const bodies = size ? BODY_TYPES_BY_SIZE[size.code] : undefined;
  const key = selectionKey(sizeId, body, lines);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    if (!remaining) return;
    const timer = setTimeout(() => setRemaining((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);
  const edit = () => { revision.current++; setVersion(revision.current); setError(""); setNote(""); };
  const setVehicle = (id: string) => { edit(); setSizeId(id); setBody(undefined); };
  const toggle = (service: ServicePackage, checked: boolean) => {
    edit();
    if (checked && lines.length >= MAX_SELECTION_LINES) { setError("Choose at most 10 services."); return; }
    const next = checked ? [...lines, { serviceId: service.id, quantity: 1 }] : lines.filter((l) => l.serviceId !== service.id);
    const kept = pruneSelection(catalog, next);
    const removed = next.filter((l) => !kept.includes(l)).map((l) => catalog.services.find((s) => s.id === l.serviceId)?.name).join(", ");
    if (removed) setNote(`${removed} was removed. It needs a main service.`);
    setLines(kept);
  };
  const chooseTab = (next: string) => { setCategory(next); };
  const focusTab = (index: number) => {
    const buttons = tabs.current?.querySelectorAll<HTMLAnchorElement>("[role=tab]");
    const tab = buttons?.[(index + CATEGORIES.length) % CATEGORIES.length];
    tab?.focus({ preventScroll: true });
    if (tab && tabs.current) tabs.current.scrollLeft += tab.offsetLeft - tabs.current.offsetLeft - 12;
  };
  const card = (service: ServicePackage) => {
    const offer = service.offers.find((o) => o.vehicleCategoryId === sizeId);
    const picked = lines.find((l) => l.serviceId === service.id);
    const compatible = service.type === "BASE" || catalog.addOnCompatibility.some((c) => c.addOnServiceId === service.id && lines.some((l) => l.serviceId === c.baseServiceId));
    // A disabled toggle always says why (17.4).
    const reason = picked || !enhanced ? null : !compatible ? "Add a main service first" : lines.length >= MAX_SELECTION_LINES ? "Limit of 10 reached" : null;
    const unavailable = !picked && offer?.onlineBooking === "UNAVAILABLE";
    const duration = offer?.duration.kind === "TIMED" ? `About ${offer.duration.minutes} min` : offer?.duration.kind === "MULTI_DAY" ? "Multi-day" : null;
    return <LandingCard key={service.id} chip={service.type === "ADD_ON" ? "Add-on" : LABELS[service.category]} duration={duration} title={service.name} price={servicePrice(service, size, body)} priceId={`landing-price-${service.id}`} arrow={serviceArrow(catalog, size, service, status, phone)}
      action={<button type="button" className="landing-toggle" aria-pressed={!!picked} disabled={!enhanced || !!reason || unavailable} aria-describedby={unavailable ? `landing-price-${service.id}` : undefined} onClick={() => toggle(service, !picked)}>{picked ? <><Check aria-hidden="true" />In estimate</> : reason ?? <><Plus aria-hidden="true" />Add to estimate</>}</button>}>
      {picked && service.unit === "PANEL" && <label className="landing-panels">Panels, 1 to 20<input aria-label={`Panels, 1 to 20, for ${service.name}`} type="number" min="1" max="20" value={picked.quantity} onChange={(e) => { edit(); setLines(lines.map((l) => l.serviceId === service.id ? { ...l, quantity: Math.max(1, Math.min(20, Math.trunc(Number(e.target.value) || 1))) } : l)); }} /></label>}
      {service.description && <p className="landing-card-text">{service.description}</p>}
      {service.inclusions.length > 0 && <details><summary>What&apos;s included</summary><ul>{service.inclusions.map((item) => <li key={item}>{item}</li>)}</ul></details>}
    </LandingCard>;
  };
  const getEstimate = async () => {
    setError("");
    if (!size) { setError("Choose your vehicle size above."); return; }
    if (bodies && !body) { setError("Choose your body type above."); return; }
    if (!lines.some((l) => catalog.services.some((s) => s.id === l.serviceId && s.type === "BASE"))) { setError("Choose at least one main service above."); return; }
    const sentKey = key, sentRevision = revision.current, vehicle = body ? `${size.name} · ${BODY_TYPE_LABEL[body]}` : size.name;
    setResult(null);
    const controller = new AbortController(); active.current = controller; setBusy(true);
    try {
      const params = new URLSearchParams({ vehicleCategoryId: size.id, lines: lines.map((l) => `${l.serviceId}:${l.quantity}`).join(","), ...(body ? { bodyType: body } : {}) });
      const response = await fetch(`/api/bookings/quote?${params}`, { cache: "no-store", signal: controller.signal });
      const answer = await response.json().catch(() => null) as (QuoteAnswer & { data?: { quote: BookingQuote } });
      if (sentRevision !== revision.current) return;
      if (!response.ok || !answer?.ok) {
        const failure = quoteFailure(response.status, answer, response.headers.get("Retry-After"));
        if (failure.seconds) setRemaining(failure.seconds);
        setError(failure.message); return;
      }
      const q = answer.data!.quote;
      setResult({ key: sentKey, revision: sentRevision, vehicle, quote: { lines: q.lines, totalPriceCentavos: q.totalPriceCentavos, estimatedTotalCentavos: q.estimatedTotalCentavos } });
    } catch { if (!controller.signal.aborted && sentRevision === revision.current) setError(quoteFailure(0, null, null).message); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  const stale = result && (result.key !== key || result.revision !== version);
  const labels = result ? estimateLabels(result.quote.lines.some((l) => l.priceStatus === "FOR_QUOTE"), result.quote.estimatedTotalCentavos) : null;
  const href = booking.href === "/book" ? bookingHref(catalog, size, lines) : booking.href;
  const step = (by: number) => { const i = CATEGORIES.indexOf(category as typeof CATEGORIES[number]); chooseTab(CATEGORIES[(i + by + 6) % 6]); focusTab(i + by); };
  return <>
    <section id="services" className="landing-section landing-wrap">
      <div className="landing-filter-head"><div><h2>Services and prices</h2><p className="landing-muted">Choose your vehicle size to see its price.</p></div>
        <div className="landing-filter-selects">
          <label className="landing-select" htmlFor="landing-size"><span>Vehicle size</span><select id="landing-size" value={sizeId} onChange={(e) => setVehicle(e.target.value)}><option value="">Choose a size</option>{catalog.vehicleCategories.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          {bodies && <label className="landing-select" htmlFor="landing-body"><span>Body type</span><select id="landing-body" value={body ?? ""} onChange={(e) => { edit(); setBody(e.target.value as VehicleBodyType || undefined); }}><option value="">Choose a body type</option>{bodies.map((b) => <option key={b} value={b}>{BODY_TYPE_LABEL[b]}</option>)}</select></label>}
        </div></div>
      <div className="landing-tab-row"><button className="landing-tab-step" hidden={!enhanced} type="button" aria-label="Previous category" onClick={() => step(-1)}><ChevronLeft aria-hidden="true" /></button><div ref={tabs} className="landing-tabs" role={enhanced ? "tablist" : undefined} aria-label={enhanced ? "Service categories" : undefined}>{CATEGORIES.map((c, i) => <a key={c} id={`tab-${c}`} href={`#services-${c}`} aria-label={LABELS[c]} role={enhanced ? "tab" : undefined} aria-selected={enhanced ? category === c : undefined} aria-controls={enhanced ? `services-${c}` : undefined} tabIndex={enhanced ? category === c ? 0 : -1 : undefined} onClick={(e) => { if (enhanced) { e.preventDefault(); chooseTab(c); } }} onKeyDown={(e) => { if (!enhanced) return; if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); focusTab(i + (e.key === "ArrowRight" ? 1 : -1)); } if (e.key === "Home" || e.key === "End") { e.preventDefault(); focusTab(e.key === "Home" ? 0 : 5); } if (e.key === " ") { e.preventDefault(); chooseTab(c); } }}>{enhanced && category === c && <Check aria-hidden="true" />}{LABELS[c]}</a>)}</div><button className="landing-tab-step" hidden={!enhanced} type="button" aria-label="Next category" onClick={() => step(1)}><ChevronRight aria-hidden="true" /></button></div>
      {CATEGORIES.map((c) => <div key={c} id={`services-${c}`} className="landing-panel" role={enhanced ? "tabpanel" : undefined} aria-labelledby={enhanced ? `tab-${c}` : undefined} hidden={enhanced && category !== c}><h3>{LABELS[c]}</h3><div className="landing-grid">{catalog.services.filter((s) => s.category === c).map(card)}</div>{!catalog.services.some((s) => s.category === c) && <p>Nothing listed here yet. Call us and ask.</p>}</div>)}
      <p className="landing-muted landing-small">Inspection prices are estimates. The shop confirms the price after seeing your vehicle.</p>
    </section>
    <section id="estimate" className="landing-section landing-wrap"><div className="landing-card landing-estimate landing-reveal"><div><h2>Estimate your price</h2><p className="landing-muted">Pick a size and services above, then get an estimate from the current price list. Nothing is booked or held, and you choose your services again when you book.</p><p>{lines.length} of {MAX_SELECTION_LINES} selected{size ? ` · ${size.name}` : ""}{body ? ` · ${BODY_TYPE_LABEL[body]}` : ""}</p>{note && <p role="status">{note}</p>}
      <button className="landing-pill landing-solid" type="button" disabled={!enhanced || busy || remaining > 0} onClick={getEstimate}>{busy ? "Getting estimate…" : remaining > 0 ? `Try again in ${remaining}s` : "Get estimate"}</button><noscript><p>The estimate needs JavaScript. Prices and booking links above still work.</p></noscript>{error && <p className="landing-error" role="alert">{error} <a href={`tel:${phone}`}>Call {brandConfig.displayPhone}</a></p>}</div>
      <div id="landing-estimate-result" className="landing-estimate-result" aria-live="polite" aria-atomic="true">{result && labels ? <>{stale && <p className="landing-stale">Out of date. Get a new estimate.</p>}<h3>{stale ? "Previous estimate" : "Your estimate"}</h3><p className="landing-small landing-muted">For: {result.vehicle}</p><ul>{result.quote.lines.map((l) => <li key={l.serviceId}><span>{l.name}{l.quantity > 1 ? ` × ${l.quantity}` : ""}</span><span>{l.priceStatus === "PRICED" ? money(l.subtotalCentavos!) : l.referenceUnitPriceCentavos === null ? "Price on inspection" : `Price on inspection · about ${money(l.referenceUnitPriceCentavos)}${l.unit === "PANEL" ? ` per panel × ${l.quantity}` : ""}`}</span></li>)}</ul><p className="landing-total">{labels.subtotal}<strong>{money(result.quote.totalPriceCentavos)}</strong></p>{labels.estimate && <p className="landing-total">Estimated total incl. inspection items<strong>{labels.estimate}</strong></p>}<p className="landing-small landing-muted">From the current price list. This is an estimate, not a booking.</p><div className="landing-actions"><a className="landing-pill landing-gold" href={stale ? booking.href : href}>{booking.label}</a><a href={messenger}>Message us about this estimate</a></div></> : <><h3>Your estimate shows here.</h3><p className="landing-muted">Fixed prices and inspection items are listed separately.</p></>}</div>
    </div></section>
  </>;
}
