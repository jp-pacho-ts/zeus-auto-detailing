import * as React from "react";
import type { Metadata } from "next";
import { brandConfig } from "@/config/brand";
import { AdminPortal } from "@/components/admin/admin-portal";

export const metadata: Metadata = {
  title: `Consumables Inventory | ${brandConfig.businessName}`,
};

export default function InventoryPage() {
  return <AdminPortal initialTab="Inventory & Consumables" />;
}
