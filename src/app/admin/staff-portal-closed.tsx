import * as React from "react";
import Link from "next/link";
import { ChevronLeft, Gauge, Phone } from "lucide-react";
import { brandConfig } from "@/config/brand";
import { Logo } from "@/components/ui/logo";

// Interim staff page (P1-09): no sign-in form and no client-side gate. P1-06 replaces it with real login.
export function StaffPortalClosed() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#09090b] px-4 py-12 text-[#f5f5f4]">
      <div className="mb-8">
        <Link href="/" aria-label="Return to public site" className="inline-flex min-h-[44px] items-center">
          <Logo />
        </Link>
      </div>

      <div className="w-full max-w-md rounded border border-border bg-[#121214] p-8 shadow-sm">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded bg-primary/10 text-primary">
          <Gauge className="h-6 w-6" aria-hidden="true" />
        </div>

        <p className="text-xs font-semibold uppercase tracking-wider text-primary">
          {brandConfig.businessName} · Shop Staff
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
          Staff portal coming soon
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Online staff sign-in isn&apos;t available yet. Contact the shop owner for schedules and bookings.
        </p>

        <a
          href={`tel:${brandConfig.contactPhone.replace(/\s+/g, "")}`}
          className="mt-6 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Phone className="h-4 w-4" aria-hidden="true" /> Call {brandConfig.displayPhone}
        </a>

        <div className="mt-6 border-t border-border pt-4 text-center">
          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back to public shop site
          </Link>
        </div>
      </div>
    </main>
  );
}
