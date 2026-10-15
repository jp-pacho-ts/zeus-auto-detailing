import * as React from "react";
import Link from "next/link";
import { Camera, MessageSquare, Phone } from "lucide-react";
import { brandConfig } from "@/config/brand";
import { Logo } from "@/components/ui/logo";

export function CustomerFooter() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-[#09090b] py-12 text-sm text-muted-foreground">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-2">
            <Logo small />
            <p className="text-xs text-muted-foreground">
              {brandConfig.shopAddress}
            </p>
            <p className="text-xs text-zinc-500">
              Hotline: {brandConfig.displayPhone} · {brandConfig.operatingHours}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-6 text-xs text-muted-foreground">
            <span className="hidden sm:inline">Studio: {brandConfig.defaultBays} Dedicated Bays</span>
            <a
              href={`tel:${brandConfig.contactPhone.replace(/\s+/g, "")}`}
              className="inline-flex min-h-[44px] items-center gap-1.5 transition-colors hover:text-foreground"
              aria-label={`Call hotline at ${brandConfig.displayPhone}`}
            >
              <Phone className="h-3.5 w-3.5 text-primary" /> {brandConfig.displayPhone}
            </a>
            <a
              href={brandConfig.facebookMessengerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-center gap-1.5 transition-colors hover:text-foreground"
              aria-label="Zeus Auto Detailing Facebook Messenger"
            >
              <MessageSquare className="h-3.5 w-3.5 text-primary" /> Messenger
            </a>
            <a
              href={brandConfig.instagram}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-center gap-1.5 transition-colors hover:text-foreground"
              aria-label="Zeus Auto Detailing Instagram"
            >
              <Camera className="h-3.5 w-3.5 text-primary" /> Instagram
            </a>
            <Link
              href="/admin/login"
              className="inline-flex min-h-[44px] items-center text-zinc-500 transition-colors hover:text-foreground"
            >
              Staff Access
            </Link>
          </div>
        </div>

        <div className="mt-8 border-t border-border pt-6 text-xs text-zinc-600">
          © {currentYear} {brandConfig.businessName}. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
