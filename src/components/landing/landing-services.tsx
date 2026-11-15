"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { BookingCatalog, BookingQuote, CatalogSelection, ServicePackage, VehicleBodyType } from "@/types/catalog-contracts";
import { BODY_TYPES_BY_SIZE, BODY_TYPE_LABEL, MAX_SELECTION_LINES } from "@/types/catalog-contracts";
import { brandConfig } from "@/config/brand";
import { bookingHref, estimateLabels, money, pruneSelection, quoteFailure, selectionKey, servicePrice, type QuoteAnswer } from "./landing-model";

export type DisplayCatalog = Omit<BookingCatalog, "catalogReleaseId" | "catalogVersion">;
const CATEGORIES = ["WASH", "DETAILING", "GRAPHENE", "TINT", "PPF", "REPAINT"] as const;
const LABELS = { WASH: "Wash", DETAILING: "Detailing", GRAPHENE: "Graphene", TINT: "Tint", PPF: "PPF", REPAINT: "Repaint" };
const subscribe = () => () => {};
// Public fields only; no signed token/release/queue or server quote object is retained in state.
type Estimate = Pick<BookingQuote, "lines" | "totalPriceCentavos" | "estimatedTotalCentavos">;
export function LandingServices({ catalog, phone, messenger, bookingLabel, bookingLink }: { catalog: DisplayCatalog; phone: string; messenger: string; bookingLabel: string; bookingLink: string }) {
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
    if (kept.length < next.length) setNote("An add-on was removed because it needs its selected main service.");
    setLines(kept);
  };
  const chooseTab = (next: string) => { setCategory(next); };
  const focusTab = (index: number) => {
    const buttons = tabs.current?.querySelectorAll<HTMLAnchorElement>("[role=tab]");
    const tab = buttons?.[(index + CATEGORIES.length) % CATEGORIES.length];
    tab?.focus({ preventScroll: true });
    if (tab && tabs.current) tabs.current.scrollLeft += tab.offsetLeft - tabs.current.offsetLeft - 12;
  };
  const vehicleControls = (prefix: string, radios: boolean) => radios ? <fieldset className="landing-desktop-sizes"><legend>Vehicle size</legend><div className="landing-size-options">{catalog.vehicleCategories.map((s) => <label key={s.id}><input type="radio" name={prefix} value={s.id} checked={sizeId === s.id} onChange={() => setVehicle(s.id)} /><span>{s.name}</span></label>)}</div></fieldset> : <label className="landing-mobile-sizes" htmlFor={prefix}>Vehicle size<select id={prefix} value={sizeId} onChange={(e) => setVehicle(e.target.value)}><option value="">Choose a vehicle size</option>{catalog.vehicleCategories.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>;
  const card = (service: ServicePackage) => {
    const offer = service.offers.find((o) => o.vehicleCategoryId === sizeId);
    const picked = lines.find((l) => l.serviceId === service.id);
    const compatible = service.type === "BASE" || catalog.addOnCompatibility.some((c) => c.addOnServiceId === service.id && lines.some((l) => l.serviceId === c.baseServiceId));
    return <article className="landing-service-card" key={service.id}>
      <div><p className="landing-eyebrow">{service.type === "ADD_ON" ? "Add-on · main service required" : LABELS[service.category]}</p><h4>{service.name}</h4></div>
      <p className="landing-price">{servicePrice(service, size, body)}</p>
      {service.description && <p>{service.description}</p>}
      {service.inclusions.length > 0 && <details><summary>What is included</summary><ul>{service.inclusions.map((item) => <li key={item}>{item}</li>)}</ul></details>}
      {offer?.duration.kind === "TIMED" && <p className="landing-small">About {offer.duration.minutes} min</p>}
      {offer?.duration.kind === "MULTI_DAY" && <p className="landing-small">Multi-day service</p>}
      <label className="landing-pick"><input type="checkbox" checked={!!picked} disabled={!enhanced || (!picked && (!compatible || offer?.onlineBooking === "UNAVAILABLE"))} onChange={(e) => toggle(service, e.target.checked)} />{picked ? "Selected for estimate" : service.type === "ADD_ON" && !compatible ? "Choose a compatible main service first" : "Add to estimate"}</label>
      {picked && service.unit === "PANEL" && <label>Panels (1–20)<input aria-label={`Panels for ${service.name}`} type="number" min="1" max="20" value={picked.quantity} onChange={(e) => { edit(); setLines(lines.map((l) => l.serviceId === service.id ? { ...l, quantity: Math.max(1, Math.min(20, Math.trunc(Number(e.target.value) || 1))) } : l)); }} /></label>}
    </article>;
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
  const href = bookingLink === "/book" ? bookingHref(catalog, size, lines) : bookingLink;
  return <>
    <section id="services" className="landing-section landing-wrap"><div className="landing-section-title"><p className="landing-eyebrow">Find your service</p><h2>Services and prices</h2><p>Choose your vehicle. See the current price list before you book.</p></div>
      <div className="landing-vehicle">{vehicleControls("landing-size-radio", true)}{vehicleControls("landing-size-select", false)}{bodies && <label htmlFor="landing-body">Body type<select id="landing-body" value={body ?? ""} onChange={(e) => { edit(); setBody(e.target.value as VehicleBodyType || undefined); }}><option value="">Choose body type</option>{bodies.map((b) => <option key={b} value={b}>{BODY_TYPE_LABEL[b]}</option>)}</select></label>}</div>
      <div className="landing-tab-row"><button hidden={!enhanced} type="button" aria-label="Previous service category" onClick={() => { const i = CATEGORIES.indexOf(category as typeof CATEGORIES[number]); chooseTab(CATEGORIES[(i + 5) % 6]); focusTab(i - 1); }}>←</button><div ref={tabs} className="landing-tabs" role={enhanced ? "tablist" : undefined} aria-label={enhanced ? "Service categories" : undefined}>{CATEGORIES.map((c, i) => <a key={c} id={`tab-${c}`} href={`#services-${c}`} aria-label={LABELS[c]} role={enhanced ? "tab" : undefined} aria-selected={enhanced ? category === c : undefined} aria-controls={enhanced ? `services-${c}` : undefined} tabIndex={enhanced ? category === c ? 0 : -1 : undefined} onClick={(e) => { if (enhanced) { e.preventDefault(); chooseTab(c); } }} onKeyDown={(e) => { if (!enhanced) return; if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); focusTab(i + (e.key === "ArrowRight" ? 1 : -1)); } if (e.key === "Home" || e.key === "End") { e.preventDefault(); focusTab(e.key === "Home" ? 0 : 5); } if (e.key === " ") { e.preventDefault(); chooseTab(c); } }}>{LABELS[c]}</a>)}</div><button hidden={!enhanced} type="button" aria-label="Next service category" onClick={() => { const i = CATEGORIES.indexOf(category as typeof CATEGORIES[number]); chooseTab(CATEGORIES[(i + 1) % 6]); focusTab(i + 1); }}>→</button></div>
      {CATEGORIES.map((c) => <div key={c} id={`services-${c}`} role={enhanced ? "tabpanel" : undefined} aria-labelledby={enhanced ? `tab-${c}` : undefined} hidden={enhanced && category !== c}><h3>{LABELS[c]}</h3><div className="landing-service-grid">{catalog.services.filter((s) => s.category === c).map(card)}</div>{!catalog.services.some((s) => s.category === c) && <p>No services currently listed in this category. Call the shop for help.</p>}</div>)}
      <p className="landing-small">Ask us about each service. Inspection prices are references, not fixed charges.</p><a className="landing-button" href={bookingLink}>{bookingLabel}</a>
    </section>
    <section id="estimate" className="landing-section landing-wrap landing-estimate"><div><p className="landing-eyebrow">Plan your visit</p><h2>Estimate your price</h2><p>Choose your vehicle and services above, then request an estimate from the shop’s current price list.</p><p>Nothing is reserved. You’ll choose your services again when you book.</p><p>{lines.length} of {MAX_SELECTION_LINES} services selected{size ? ` · ${size.name}` : ""}{body ? ` · ${BODY_TYPE_LABEL[body]}` : ""}</p>{note && <p role="status">{note}</p>}
      <button className="landing-button" type="button" disabled={!enhanced || busy || remaining > 0} onClick={getEstimate}>{busy ? "Getting estimate…" : remaining > 0 ? `Try again in ${remaining}s` : "Get estimate"}</button><noscript><p>The calculator needs JavaScript. Prices above and booking links still work.</p></noscript>{error && <p className="landing-error" role="alert">{error} <a href={`tel:${phone}`}>Call {brandConfig.displayPhone}</a></p>}</div>
      <div className="landing-estimate-result" aria-live="polite" aria-atomic="true">{result && labels ? <>{stale && <p className="landing-stale">Out of date — get a new estimate</p>}<h3>{stale ? "Previous estimate" : "Your estimate"}</h3><p className="landing-small">For: {result.vehicle}</p><ul>{result.quote.lines.map((l) => <li key={l.serviceId}><span>{l.name}{l.quantity > 1 ? ` × ${l.quantity}` : ""}</span><span>{l.priceStatus === "PRICED" ? money(l.subtotalCentavos!) : l.referenceUnitPriceCentavos === null ? "Price on inspection" : `Price on inspection · about ${money(l.referenceUnitPriceCentavos)}${l.unit === "PANEL" ? ` per panel × ${l.quantity}` : ""}`}</span></li>)}</ul><p className="landing-total">{labels.subtotal}<strong>{money(result.quote.totalPriceCentavos)}</strong></p>{labels.estimate && <p className="landing-total">Estimated total incl. inspection items<strong>{labels.estimate}</strong></p>}<p className="landing-small">From the shop’s current price list. An estimate, not a booking.</p><div className="landing-actions"><a className="landing-button" href={stale ? bookingLink : href}>{bookingLabel}</a><a href={messenger}>Message us about this estimate</a></div></> : <><p className="landing-eyebrow">Your estimate will appear here</p><p>Fixed prices and inspection items are listed separately. No booking is created.</p></>}</div>
    </section>
  </>;
}
