import * as React from "react";
import type { Metadata } from "next";
import { brandConfig } from "@/config/brand";
import { BookingWizard } from "@/components/booking/booking-wizard";
import { BookingStage } from "@/components/booking/booking-stage";

export const metadata: Metadata = {
  title: `Book an Appointment | ${brandConfig.businessName}`,
  description: `Book your detailing appointment at ${brandConfig.businessName} in ${brandConfig.location}.`,
};

interface BookPageProps {
  searchParams: Promise<{ service?: string; vehicle?: string }>;
}

export default async function BookPage({ searchParams }: BookPageProps) {
  const params = await searchParams;
  return (
    <BookingStage>
      <BookingWizard initialServiceId={params.service} initialVehicleName={params.vehicle} />
    </BookingStage>
  );
}
