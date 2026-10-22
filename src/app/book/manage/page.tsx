import type { Metadata } from "next";
import { brandConfig } from "@/config/brand";
import { ManageBooking } from "@/components/booking/manage-booking-page";

// The private booking page (ADR-002): no URL parameters; the booking code is entered on the page.
export const metadata: Metadata = {
  title: `Your Booking | ${brandConfig.businessName}`,
  description: `See, change or cancel your ${brandConfig.businessName} booking.`,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function ManageBookingPage() {
  return <ManageBooking />;
}
