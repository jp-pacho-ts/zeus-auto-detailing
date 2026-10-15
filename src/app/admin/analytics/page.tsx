import * as React from "react";
import type { Metadata } from "next";
import { brandConfig } from "@/config/brand";
import { AdminPortal } from "@/components/admin/admin-portal";

export const metadata: Metadata = {
  title: `Sales Analytics | ${brandConfig.businessName}`,
};

export default function AnalyticsPage() {
  return <AdminPortal initialTab="Sales Analytics" />;
}
