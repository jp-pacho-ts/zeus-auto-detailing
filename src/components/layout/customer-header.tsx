"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Menu, X } from "lucide-react";
import { Logo } from "@/components/ui/logo";

// P1-19 W2: the booking call to action comes from the page (it dials the shop while booking is paused).
export function CustomerHeader({ bookHref = "/book", bookLabel = "Book an Appointment" }: { bookHref?: string; bookLabel?: string } = {}) {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  return (
    <header className="relative border-b border-border bg-[#09090b]">
      <div className="mx-auto flex h-20 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" aria-label="Zeus Auto Detailing Home" className="inline-flex min-h-[44px] items-center">
          <Logo />
        </Link>

        {/* Desktop Navigation */}
        <nav
          aria-label="Shop Navigation"
          className="hidden items-center gap-6 md:flex text-sm font-medium text-muted-foreground"
        >
          <a
            href="#services"
            className="inline-flex min-h-[44px] items-center px-2 py-2.5 transition-colors hover:text-foreground"
          >
            Detailing Services
          </a>
          <a
            href="#location"
            className="inline-flex min-h-[44px] items-center px-2 py-2.5 transition-colors hover:text-foreground"
          >
            Shop & Hours
          </a>
        </nav>

        {/* Action Button: Strictly no admin button */}
        <div className="hidden items-center gap-4 md:flex">
          <Link
            href={bookHref}
            className="inline-flex min-h-[44px] items-center gap-2 rounded bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            {bookLabel} <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>

        {/* Mobile menu trigger */}
        <button
          type="button"
          onClick={() => setMobileMenuOpen((prev) => !prev)}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded text-muted-foreground hover:text-foreground md:hidden"
          aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileMenuOpen}
        >
          {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileMenuOpen && (
        <div className="border-b border-border bg-[#121214] px-4 py-6 md:hidden">
          <nav className="flex flex-col space-y-4 text-base font-medium text-muted-foreground">
            <a
              href="#services"
              onClick={() => setMobileMenuOpen(false)}
              className="flex min-h-[44px] items-center py-3 hover:text-foreground"
            >
              Detailing Services
            </a>
            <a
              href="#location"
              onClick={() => setMobileMenuOpen(false)}
              className="flex min-h-[44px] items-center py-3 hover:text-foreground"
            >
              Shop & Hours
            </a>
            <div className="pt-2">
              <Link
                href={bookHref}
                onClick={() => setMobileMenuOpen(false)}
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary-hover"
              >
                {bookLabel} <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
