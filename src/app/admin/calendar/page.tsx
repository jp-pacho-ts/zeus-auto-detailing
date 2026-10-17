import * as React from "react";
import type { Metadata } from "next";
import { brandConfig } from "@/config/brand";
import { AdminPortal } from "@/components/admin/admin-portal";
import { requireStaffPage } from "@/server/auth/guards";

export const metadata: Metadata = {
  title: `Bay Schedule & Calendar | ${brandConfig.businessName}`,
};

export default async function CalendarPage() {
  await requireStaffPage("/admin/calendar");
  return <AdminPortal initialTab="Bay Calendar" />;
}
