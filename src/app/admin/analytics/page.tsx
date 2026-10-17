import * as React from "react";
import type { Metadata } from "next";
import { brandConfig } from "@/config/brand";
import { AdminPortal } from "@/components/admin/admin-portal";
import { requireStaffPage } from "@/server/auth/guards";

export const metadata: Metadata = {
  title: `Sales Analytics | ${brandConfig.businessName}`,
};

export default async function AnalyticsPage() {
  await requireStaffPage("/admin/analytics");
  return <AdminPortal initialTab="Sales Analytics" />;
}
