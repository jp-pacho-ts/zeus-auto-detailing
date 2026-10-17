import * as React from "react";
import type { Metadata } from "next";
import { brandConfig } from "@/config/brand";
import { AdminPortal } from "@/components/admin/admin-portal";
import { requireStaffPage } from "@/server/auth/guards";

export const metadata: Metadata = {
  title: `Team & Commissions | ${brandConfig.businessName}`,
};

export default async function DetailersPage() {
  await requireStaffPage("/admin/detailers");
  return <AdminPortal initialTab="Team & Commissions" />;
}
