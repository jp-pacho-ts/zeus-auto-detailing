import type { Metadata } from "next";
import { getLandingStatus } from "@/server/landing/status";
import { getBookingCatalog } from "@/server/catalog";
import { LandingPage } from "@/components/landing/landing-page";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Website preview | Zeus Auto Detailing", description: "Car and motorcycle detailing in Tacloban City. Services, prices and online booking.", robots: { index: false, follow: false }, openGraph: { title: "Website preview | Zeus Auto Detailing", description: "Car and motorcycle detailing in Tacloban City. Services, prices and online booking." } };
export default async function LandingPreviewPage() {
    const [catalog, status] = await Promise.all([getBookingCatalog(), getLandingStatus()]);
    return <LandingPage catalog={catalog.ok ? catalog.data : null} status={status} />;
}
