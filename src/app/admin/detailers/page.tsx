import * as React from "react";
import type { Metadata } from "next";
import { brandConfig } from "@/config/brand";
import { AdminPortal } from "@/components/admin/admin-portal";

export const metadata: Metadata = {
  title: `Detailers & Commissions | ${brandConfig.businessName}`,
};

export default function DetailersPage() {
  return <AdminPortal initialTab="Detailers & Commissions" />;
}
