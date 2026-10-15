"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Menu, X } from "lucide-react";
import { Logo } from "@/components/ui/logo";

export function CustomerHeader() {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  return (
    <header className="relative border-b border-border bg-[#09090b]">
      <div className="mx-auto flex h-20 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" aria-label="Zeus Auto Detailing Home">
          <Logo />
        </Link>

        {/* Desktop Navigation */}
        <nav
          aria-label="Studio Navigation"
          className="hidden items-center gap-8 md:flex text-sm font-medium text-muted-foreground"
        >
          <a
            href="#services"
            className="transition-colors hover:text-foreground"
          >
            Treatments
          </a>
          <a
            href="#estimator"
            className="transition-colors hover:text-foreground"
          >
            Bay Estimator
          </a>
          <a
            href="#location"
            className="transition-colors hover:text-foreground"
          >
            Studio & Hours
          </a>
        </nav>

        {/* Action Button: Strictly no admin button */}
        <div className="hidden items-center gap-4 md:flex">
          <Link
            href="/book"
            className="inline-flex min-h-[44px] items-center gap-2 rounded bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            Reserve Detailing Bay <ArrowRight className="h-4 w-4" />
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
              className="hover:text-foreground"
            >
              Treatments
            </a>
            <a
              href="#estimator"
              onClick={() => setMobileMenuOpen(false)}
              className="hover:text-foreground"
            >
              Bay Estimator
            </a>
            <a
              href="#location"
              onClick={() => setMobileMenuOpen(false)}
              className="hover:text-foreground"
            >
              Studio & Hours
            </a>
            <div className="pt-2">
              <Link
                href="/book"
                onClick={() => setMobileMenuOpen(false)}
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary-hover"
              >
                Reserve Detailing Bay <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
