import * as React from "react";
import type { Metadata } from "next";
import { brandConfig } from "@/config/brand";
import { AdminPortal, type AdminTab } from "@/components/admin/admin-portal";
import { requireStaffPage } from "@/server/auth/guards";

export const metadata: Metadata = {
  title: `Shop Management | ${brandConfig.businessName}`,
  description: `Manage appointments, bay calendar, team roster, and sales analytics for ${brandConfig.businessName}.`,
};

interface AdminPageProps {
  searchParams: Promise<{ tab?: string }>;
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  await requireStaffPage("/admin");
  const params = await searchParams;
  const initialTab = (params.tab as AdminTab) || "Bookings";

  return <AdminPortal initialTab={initialTab} />;
}
