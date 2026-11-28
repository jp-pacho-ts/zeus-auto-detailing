import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LandingComingSoon } from "@/components/landing/landing-coming-soon";
import { menuPage } from "@/components/landing/landing-pages";
import { landingPhoto } from "@/components/landing/landing-photos";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Coming soon | Zeus Auto Detailing", robots: { index: false, follow: false } };

// Header menu pages; any other /preview/<x> is a 404. The static /preview/landing route wins over this one.
export default async function MenuComingSoonPage({ params }: { params: Promise<{ page: string }> }) {
  const page = menuPage((await params).page);
  if (!page) notFound();
  return <LandingComingSoon title={page.title} photo={landingPhoto(page.photo)} />;
}
