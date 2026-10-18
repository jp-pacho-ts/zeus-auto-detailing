import * as React from "react";
import type { Metadata } from "next";
import { brandConfig } from "@/config/brand";
import { AdminPortal } from "@/components/admin/admin-portal";
import { requireStaffPage } from "@/server/auth/guards";

export const metadata: Metadata = {
  title: `Appointments & Bookings | ${brandConfig.businessName}`,
};

export default async function BookingsPage() {
  await requireStaffPage("/admin/bookings");
  return <AdminPortal initialTab="Bookings" />;
}
