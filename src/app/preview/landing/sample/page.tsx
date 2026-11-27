import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LandingPage } from "@/components/landing/landing-page";
import { SAMPLE_CATALOG } from "./sample-catalog";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sample data | Zeus Auto Detailing", robots: { index: false, follow: false } };

// Dev-only design review of the landing page with invented prices and promos (no database). 404 in production.
export default function LandingSamplePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <>
    <p role="note" style={{ position: "fixed", insetInline: 0, bottom: 0, zIndex: 2000, margin: 0, padding: "6px 12px", background: "#b91c1c", color: "#fff", font: "600 12px/1.4 system-ui, sans-serif", textAlign: "center" }}>
      Sample data for design review: prices and promos are invented, not real.
    </p>
    <LandingPage catalog={SAMPLE_CATALOG} status="OPEN" />
  </>;
}
