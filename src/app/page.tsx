import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  Clock,
  MapPin,
  MessageSquare,
  Phone,
  Shield,
  Wrench,
} from "lucide-react";
import { brandConfig } from "@/config/brand";
import { services, formatCurrency } from "@/config/catalog";
import { CustomerHeader } from "@/components/layout/customer-header";
import { CustomerFooter } from "@/components/layout/customer-footer";
import { BayEstimator } from "@/components/home/bay-estimator";

export default function HomePage() {
  // Group services by discipline
  const disciplines = Array.from(
    new Set(services.map((s) => s.discipline)),
  );

  return (
    <div className="min-h-screen bg-[#09090b] text-[#f5f5f4]">
      <CustomerHeader />

      <main>
        {/* 1. Hero Section: Confident, architectural, grounded */}
        <section
          aria-labelledby="hero-title"
          className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28"
        >
          <div className="max-w-3xl">
            <h1
              id="hero-title"
              className="text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl lg:text-6xl"
            >
              Precision paint restoration and ceramic protection.
            </h1>

            <p className="mt-6 text-lg leading-relaxed text-muted-foreground sm:text-xl">
              Tacloban&apos;s dedicated auto detailing shop delivering multi-stage paint
              correction, certified 9H graphene coatings, and restorative cabin detailing
              by appointment.
            </p>

            <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center">
              <Link
                href="/book"
                className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded bg-primary px-6 py-3 text-base font-bold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                Book an Appointment <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <a
                href="#services"
                className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded border border-border bg-[#18181b] px-6 py-3 text-base font-medium text-foreground transition-colors hover:border-zinc-700"
              >
                View Detailing Services
              </a>
            </div>
          </div>

          {/* Authentic Shop Facts (Grounded in Reality) */}
          <div
            aria-label="Shop Capabilities"
            className="mt-16 grid grid-cols-2 gap-4 border-t border-border pt-8 sm:grid-cols-4"
          >
            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
                <Wrench className="h-3.5 w-3.5" aria-hidden="true" /> Detailing Bays
              </p>
              <p className="mt-1 text-base font-bold text-foreground">
                {brandConfig.defaultBays} Dedicated Bays
              </p>
              <p className="text-xs text-muted-foreground">
                Dedicated indoor bays
              </p>
            </div>

            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
                <Shield className="h-3.5 w-3.5" aria-hidden="true" /> Surface Chemistry
              </p>
              <p className="mt-1 text-base font-bold text-foreground">
                9H Graphene & Ceramic
              </p>
              <p className="text-xs text-muted-foreground">
                Certified application
              </p>
            </div>

            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" /> Operating Hours
              </p>
              <p className="mt-1 text-base font-bold text-foreground">
                Mon — Sun 8AM–6PM
              </p>
              <p className="text-xs text-muted-foreground">
                Daily shop hours
              </p>
            </div>

            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" /> Location
              </p>
              <p className="mt-1 text-base font-bold text-foreground">
                {brandConfig.location}
              </p>
              <p className="text-xs text-muted-foreground">
                {brandConfig.landmark}
              </p>
            </div>
          </div>
        </section>

        {/* 2. Signature Live Thing: Interactive Bay & Duration Estimator */}
        <div id="estimator">
          <BayEstimator />
        </div>

        {/* 3. Editorial Service Menu: Divided by treatment discipline */}
        <section
          id="services"
          aria-labelledby="services-title"
          className="mx-auto max-w-6xl px-4 py-20 sm:px-6"
        >
          <div className="max-w-2xl">
            <p className="text-sm font-semibold tracking-wide text-primary">
              Detailing Services
            </p>
            <h2
              id="services-title"
              className="mt-2 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl"
            >
              Craft treatments engineered for optical clarity.
            </h2>
            <p className="mt-3 text-base text-muted-foreground">
              Every vehicle undergoes inspection and decontamination before mechanical work.
              Transparent pricing with no hidden surcharges.
            </p>
          </div>

          <div className="mt-14 space-y-16">
            {disciplines.map((discipline) => {
              const disciplineServices = services.filter(
                (s) => s.discipline === discipline,
              );

              return (
                <div key={discipline} className="border-t border-border pt-10">
                  <div className="mb-6 flex flex-col justify-between gap-2 sm:flex-row sm:items-baseline">
                    <h3 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                      {discipline}
                    </h3>
                    <span className="text-xs font-medium text-muted-foreground">
                      {disciplineServices.length} {disciplineServices.length === 1 ? "package" : "packages"} available
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                    {disciplineServices.map((service) => (
                      <div
                        key={service.id}
                        className="flex flex-col justify-between rounded border border-border bg-[#121214] p-6 transition-colors hover:border-zinc-700"
                      >
                        <div>
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <span className="inline-block rounded bg-primary/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-primary">
                                {service.tag}
                              </span>
                              <h4 className="mt-2 text-lg font-bold text-foreground">
                                {service.name}
                              </h4>
                            </div>
                            <div className="text-right">
                              <span className="text-xl font-extrabold tabular-nums text-foreground">
                                {formatCurrency(service.price)}
                              </span>
                              <span className="block text-xs text-muted-foreground">
                                Base (Sedan)
                              </span>
                            </div>
                          </div>

                          <p className="mt-3 text-sm text-muted-foreground">
                            {service.desc}
                          </p>

                          <div className="mt-4 flex items-center gap-2 text-xs font-medium text-foreground">
                            <Clock className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                            Estimated Service Duration: {service.durationLabel}
                          </div>

                          <ul
                            aria-label={`Inclusions for ${service.name}`}
                            className="mt-5 space-y-2 border-t border-border/60 pt-4 text-xs text-zinc-300"
                          >
                            {service.features.map((feat) => (
                              <li key={feat} className="flex items-start gap-2">
                                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                                <span>{feat}</span>
                              </li>
                            ))}
                          </ul>

                          <p className="mt-4 text-[11px] text-muted-foreground italic">
                            Note: {service.multiplierNote}
                          </p>
                        </div>

                        <div className="mt-6 pt-4 border-t border-border">
                          <Link
                            href={`/book?service=${encodeURIComponent(service.id)}&vehicle=sedan`}
                            className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded bg-[#18181b] border border-border px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:border-primary hover:text-primary"
                          >
                            Book an Appointment <ArrowRight className="h-4 w-4" aria-hidden="true" />
                          </Link>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 4. Shop Location, Operating Schedule & Contact */}
        <section
          id="location"
          aria-labelledby="location-title"
          className="border-t border-border bg-[#121214] py-20"
        >
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-12">
              <div className="lg:col-span-7">
                <p className="text-sm font-semibold tracking-wide text-primary">
                  Shop Location & Schedule
                </p>
                <h2
                  id="location-title"
                  className="mt-2 text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl"
                >
                  Located along Maharlika Highway, Caibaan.
                </h2>
                <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                  Zeus Auto Detailing operates along Maharlika Highway corner Villa Mayor in Brgy 95 Caibaan, Tacloban City. Due to our commitment to allocating dedicated bay time per vehicle, all multi-stage corrections and ceramic coating applications require advance appointment scheduling.
                </p>

                <div className="mt-8 space-y-5">
                  <div className="flex items-start gap-3">
                    <MapPin className="mt-1 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                    <div>
                      <p className="text-sm font-bold text-foreground">Shop Address</p>
                      <p className="text-sm text-muted-foreground">{brandConfig.shopAddress}</p>
                      <p className="text-xs text-zinc-400">{brandConfig.landmark}</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <Clock className="mt-1 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                    <div>
                      <p className="text-sm font-bold text-foreground">Operating Schedule</p>
                      <p className="text-sm text-muted-foreground">{brandConfig.operatingHours}</p>
                      <p className="text-xs text-zinc-400">{brandConfig.operatingSchedule}</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <Phone className="mt-1 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                    <div>
                      <p className="text-sm font-bold text-foreground">Telephone & Mobile</p>
                      <a
                        href={`tel:${brandConfig.contactPhone.replace(/\s+/g, "")}`}
                        className="inline-flex min-h-[44px] items-center text-sm font-semibold text-primary transition-colors hover:text-primary-hover"
                        aria-label={`Call shop hotline at ${brandConfig.displayPhone}`}
                      >
                        {brandConfig.displayPhone} ({brandConfig.contactPhone})
                      </a>
                      <p className="text-xs text-zinc-400">Shop hotline for vehicle inquiries & appointment booking</p>
                    </div>
                  </div>

                  <div className="flex items-start gap-3">
                    <MessageSquare className="mt-1 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                    <div>
                      <p className="text-sm font-bold text-foreground">Social & Inquiries</p>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
                        <a
                          href={brandConfig.facebookMessengerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-[44px] items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
                          aria-label="Facebook Messenger Zeus Auto Detailing Tacloban"
                        >
                          Messenger: {brandConfig.facebook}
                        </a>
                        <span className="text-zinc-400">·</span>
                        <a
                          href={brandConfig.instagram}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-[44px] items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
                          aria-label="Instagram Zeus Auto Detailing"
                        >
                          Instagram
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Before Your Appointment Card */}
              <div className="lg:col-span-5">
                <div className="rounded border border-border bg-[#18181b] p-8">
                  <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                    Before Your Appointment
                  </p>
                  <h3 className="mt-2 text-xl font-bold text-foreground">
                    Appointment Guidelines
                  </h3>
                  <ul className="mt-4 space-y-3 text-sm text-zinc-400">
                    <li className="flex items-start gap-2.5">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                      <span>
                        <strong className="text-foreground">Advance Booking Recommended:</strong> Advance appointment scheduling is recommended for multi-stage paint correction and ceramic coatings.
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                      <span>
                        <strong className="text-foreground">Intake Walkaround:</strong> An intake condition walkaround is conducted on arrival together with you before work begins.
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                      <span>
                        <strong className="text-foreground">Convenient Location:</strong> Located along Maharlika Highway Corner Villa Mayor, Brgy 95 Caibaan, Tacloban City with customer parking.
                      </span>
                    </li>
                  </ul>

                  <div className="mt-6 border-t border-border pt-6">
                    <Link
                      href="/book?vehicle=sedan"
                      className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded bg-primary px-5 py-3 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      Book an Appointment <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                    <p className="mt-3 text-center text-xs text-zinc-400">
                      Need same-day guidance? Call hotline at {brandConfig.displayPhone}.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <CustomerFooter />
    </div>
  );
}
