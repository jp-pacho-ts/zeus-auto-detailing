import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getBookingCatalog } from "@/server/catalog";
import { LandingComingSoon } from "@/components/landing/landing-coming-soon";
import { categoryPage } from "@/components/landing/landing-pages";
import { landingPhoto } from "@/components/landing/landing-photos";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Coming soon | Zeus Auto Detailing", robots: { index: false, follow: false } };

// LE 2026-11-20: service pages are not built yet. A known category, or a service slug from the live catalog, gets the
// coming-soon page; anything else is a 404, so the title is never taken from the URL.
export default async function ServiceComingSoonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const category = categoryPage(slug);
  if (category) return <LandingComingSoon title={category.title} photo={landingPhoto(category.photo)} />;
  const catalog = await getBookingCatalog();
  const service = catalog.ok ? catalog.data.services.find((s) => s.slug === slug) : undefined;
  if (!service) notFound();
  return <LandingComingSoon title={service.name} photo={landingPhoto(service.slug)} />;
}
