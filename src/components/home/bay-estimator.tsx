"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  Bike,
  Car,
  CarFront,
  Droplets,
  Scaling,
  ShieldCheck,
  Sparkles,
  Timer,
  Truck,
  Wind,
} from "lucide-react";
import {
  services,
  vehicles,
  calculateEstimatedPrice,
  calculateEstimatedMinutes,
  formatDuration,
  formatCurrency,
} from "@/config/catalog";
import { brandConfig } from "@/config/brand";

function getVehicleIcon(vehicleId: string) {
  switch (vehicleId) {
    case "suv":
      return CarFront;
    case "pickup":
      return Truck;
    case "motorcycle":
      return Bike;
    default:
      return Car;
  }
}

function getDisciplineIcon(discipline: string) {
  const lower = discipline.toLowerCase();
  if (lower.includes("ceramic") || lower.includes("protection")) return ShieldCheck;
  if (lower.includes("paint") || lower.includes("correction")) return Sparkles;
  if (lower.includes("interior") || lower.includes("sanitization")) return Wind;
  if (lower.includes("wash") || lower.includes("decontamination")) return Droplets;
  return ShieldCheck;
}

export function BayEstimator() {
  const [selectedVehicleId, setSelectedVehicleId] = React.useState<string>("sedan");
  const [selectedServiceId, setSelectedServiceId] = React.useState<string>(
    services[0].id,
  );

  const selectedVehicle =
    vehicles.find((v) => v.id === selectedVehicleId) ?? vehicles[0];
  const selectedService =
    services.find((s) => s.id === selectedServiceId) ?? services[0];

  const estimatedPrice = calculateEstimatedPrice(
    selectedService.price,
    selectedVehicle.multiplier,
  );
  const estimatedMinutes = calculateEstimatedMinutes(
    selectedService.mins,
    selectedVehicle.typicalBayTimeAddMinutes,
  );

  return (
    <section
      aria-labelledby="estimator-title"
      className="border-y border-border bg-[#121214] py-16"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mb-10 max-w-2xl">
          <p className="text-sm font-semibold tracking-wide text-primary">
            Estimate Your Service
          </p>
          <h2
            id="estimator-title"
            className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl"
          >
            Estimate service duration and investment.
          </h2>
          <p className="mt-3 text-base text-muted-foreground">
            Select your vehicle classification and detailing service to see estimated duration and pricing for your vehicle.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          {/* Controls Column */}
          <div className="space-y-6 lg:col-span-7">
            {/* 1. Vehicle Selection */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                1. Select Vehicle Classification
              </label>
              <div
                role="radiogroup"
                aria-label="Vehicle Classification"
                className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4"
              >
                {vehicles.map((v) => {
                  const isSelected = v.id === selectedVehicleId;
                  const VehicleIcon = getVehicleIcon(v.id);
                  return (
                    <button
                      type="button"
                      key={v.id}
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() => setSelectedVehicleId(v.id)}
                      className={`flex min-h-[64px] flex-col justify-center rounded border p-3 text-left transition-colors ${
                        isSelected
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border bg-[#18181b] text-muted-foreground hover:border-zinc-700 hover:text-foreground"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <VehicleIcon className="h-5 w-5 text-primary shrink-0" aria-hidden="true" />
                        <span className="text-sm font-semibold text-foreground">
                          {v.name.split("/")[0].trim()}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {v.multiplier === 1.0
                          ? "Standard baseline"
                          : `${v.multiplier}x scale`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Service Selection */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                2. Select Detailing Service
              </label>
              <div
                role="radiogroup"
                aria-label="Detailing Service"
                className="mt-3 space-y-2.5"
              >
                {services.map((s) => {
                  const isSelected = s.id === selectedServiceId;
                  const TreatmentIcon = getDisciplineIcon(s.discipline);
                  return (
                    <button
                      type="button"
                      key={s.id}
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() => setSelectedServiceId(s.id)}
                      className={`flex w-full min-h-[64px] items-center justify-between rounded border p-4 text-left transition-colors ${
                        isSelected
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border bg-[#18181b] text-muted-foreground hover:border-zinc-700 hover:text-foreground"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-border bg-[#121214]">
                          <TreatmentIcon className="h-5 w-5 text-primary shrink-0" aria-hidden="true" />
                        </div>
                        <div>
                          <span className="text-sm font-medium text-foreground">
                            {s.name}
                          </span>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {s.discipline} · Base {s.durationLabel}
                          </p>
                        </div>
                      </div>
                      <span className="ml-4 shrink-0 font-semibold tabular-nums text-foreground">
                        {formatCurrency(s.price)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Results Summary Column */}
          <div className="lg:col-span-5">
            <div className="sticky top-24 rounded border border-border bg-[#18181b] p-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                Your Service Estimate
              </p>

              <div className="mt-4 border-b border-border pb-4">
                <h3 className="text-lg font-bold text-foreground">
                  {selectedService.name}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Configured for:{" "}
                  <span className="font-medium text-foreground">
                    {selectedVehicle.name}
                  </span>
                </p>
              </div>

              <div className="mt-5 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Timer className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
                    Estimated Service Duration
                  </span>
                  <span className="text-sm font-bold tabular-nums text-foreground">
                    {formatDuration(estimatedMinutes)}
                  </span>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Scaling className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
                      Vehicle Size Adjustment
                    </span>
                    <span className="text-sm font-medium text-foreground">
                      {selectedVehicle.multiplier === 1.0
                        ? "Standard baseline (1.0x)"
                        : `${selectedVehicle.multiplier}x scale factor`}
                    </span>
                  </div>
                  <p className="mt-1 pl-6 text-xs text-zinc-400">
                    Pricing and duration scale with surface area and vehicle proportions.
                  </p>
                </div>

                <div className="border-t border-border pt-4">
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm text-muted-foreground">
                      Estimated Investment
                    </span>
                    <span className="text-3xl font-extrabold tabular-nums tracking-tight text-foreground">
                      {formatCurrency(estimatedPrice)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Taxes and chemical consumables included. Final surface assessment conducted on arrival.
                  </p>
                </div>
              </div>

              <div className="mt-6">
                <Link
                  href={`/book?service=${encodeURIComponent(
                    selectedService.id,
                  )}&vehicle=${encodeURIComponent(selectedVehicle.name)}`}
                  className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded bg-primary px-5 py-3 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                >
                  Book an Appointment <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <p className="mt-2 text-center text-xs text-muted-foreground">
                  Operating schedule: {brandConfig.operatingHours}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
