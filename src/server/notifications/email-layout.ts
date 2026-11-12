import "server-only";
import { brandConfig } from "@/config/brand";
import type { DayBookingView } from "@/types/contracts";

// One layout for every customer email. Tables and inline styles only: Gmail, Outlook and phone mail apps drop <style> blocks
// and flexbox. White card on a light page, the dark-text logo, gold only for the button and the reference.
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const GOLD = "#c08818", INK = "#18181b", MUTED = "#52525b", LINE = "#e4e4e7";

export interface EmailBody {
  origin: string;
  preheader: string; // the grey preview line in the inbox list
  heading: string;
  intro: string;
  booking: DayBookingView;
  dropOff?: string; // overrides the plain booking date, e.g. "Tomorrow, 2026-11-13"
  note?: string;
  button?: { label: string; href: string };
}

export function customerEmailHtml(e: EmailBody): string {
  const b = e.booking;
  const estimate =
    b.estimatedTotalCentavos === null
      ? "To be quoted by the shop"
      : brandConfig.currency + " " + (b.estimatedTotalCentavos / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const row = (label: string, value: string) =>
    `<tr><td style="padding:8px 0;color:${MUTED};font-size:14px;">${esc(label)}</td><td align="right" style="padding:8px 0;color:${INK};font-size:14px;font-weight:600;">${esc(value)}</td></tr>`;
  const services = b.lines
    .map(
      (l) =>
        `<tr><td style="padding:6px 0;color:${INK};font-size:14px;">${esc(l.name)}${l.quantity > 1 ? " &times; " + l.quantity : ""}</td><td align="right" style="padding:6px 0;color:${MUTED};font-size:13px;">${l.priceStatus === "FOR_QUOTE" ? "For quote" : ""}</td></tr>`,
    )
    .join("");
  const phoneHref = brandConfig.supportPhone.replace(/\s/g, "");
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(e.heading)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(e.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid ${LINE};border-radius:12px;">
<tr><td align="center" style="padding:32px 32px 8px;"><img src="${esc(e.origin)}/images/logo-light.png" width="160" alt="${esc(brandConfig.businessName)}" style="display:block;width:160px;max-width:60%;height:auto;border:0;"></td></tr>
<tr><td style="padding:16px 32px 0;">
<h1 style="margin:0 0 8px;color:${INK};font-size:22px;line-height:1.3;font-weight:700;">${esc(e.heading)}</h1>
<p style="margin:0;color:${MUTED};font-size:15px;line-height:1.6;">${esc(e.intro)}</p>
</td></tr>
<tr><td style="padding:24px 32px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fafafa;border:1px solid ${LINE};border-radius:8px;">
<tr><td style="padding:16px 20px;"><span style="display:block;color:${MUTED};font-size:12px;">Booking reference</span><span style="display:block;margin-top:2px;color:${GOLD};font-size:20px;font-weight:700;letter-spacing:1px;font-family:Menlo,Consolas,monospace;">${esc(b.referenceCode)}</span></td></tr>
</table></td></tr>
<tr><td style="padding:16px 32px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid ${LINE};">
${row("Drop-off day", e.dropOff ?? b.bookingDate)}${row("Vehicle size", b.vehicleCategoryName)}${row("Estimated total", estimate)}
</table></td></tr>
<tr><td style="padding:16px 32px 0;"><p style="margin:0 0 4px;color:${MUTED};font-size:12px;">Services</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${services}</table></td></tr>
${e.note ? `<tr><td style="padding:16px 32px 0;"><p style="margin:0;padding:12px 16px;background:#fffbeb;border-left:3px solid ${GOLD};color:${INK};font-size:14px;line-height:1.5;">${esc(e.note)}</p></td></tr>` : ""}
${
  e.button
    ? `<tr><td align="center" style="padding:28px 32px 4px;"><a href="${esc(e.button.href)}" style="display:inline-block;background:${GOLD};color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:13px 28px;border-radius:8px;">${esc(e.button.label)}</a>
<p style="margin:10px 0 0;color:${MUTED};font-size:12px;">Enter your reference code and last name on that page.</p></td></tr>`
    : ""
}
<tr><td style="padding:28px 32px 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${LINE};">
<tr><td style="padding-top:16px;color:${MUTED};font-size:13px;line-height:1.6;">
<strong style="color:${INK};">${esc(brandConfig.businessName)}</strong><br>${esc(brandConfig.address)}<br>${esc(brandConfig.operatingSchedule)}<br>
<a href="tel:${esc(phoneHref)}" style="color:${INK};">${esc(brandConfig.supportPhone)}</a> &middot; <a href="${esc(brandConfig.facebookMessengerUrl)}" style="color:${INK};">Messenger</a>
</td></tr></table></td></tr>
</table></td></tr></table></body></html>`;
}
