import * as React from "react";
import type { Metadata } from "next";
import { brandConfig } from "@/config/brand";
import { BookingWizard } from "@/components/booking/booking-wizard";

export const metadata: Metadata = {
  title: `Reserve Detailing Bay | ${brandConfig.businessName}`,
  description: `Reserve your detailing bay at ${brandConfig.businessName} in ${brandConfig.location}.`,
};

interface BookPageProps {
  searchParams: Promise<{ service?: string; vehicle?: string }>;
}

export default async function BookPage({ searchParams }: BookPageProps) {
  const params = await searchParams;
  return (
    <BookingWizard
      initialServiceId={params.service}
      initialVehicleName={params.vehicle}
    />
  );
}
