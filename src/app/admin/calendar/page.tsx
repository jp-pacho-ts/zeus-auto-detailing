import * as React from "react";
import type { Metadata } from "next";
import { brandConfig } from "@/config/brand";
import { AdminPortal } from "@/components/admin/admin-portal";

export const metadata: Metadata = {
  title: `Bay Schedule & Calendar | ${brandConfig.businessName}`,
};

export default function CalendarPage() {
  return <AdminPortal initialTab="Bay Calendar" />;
}
