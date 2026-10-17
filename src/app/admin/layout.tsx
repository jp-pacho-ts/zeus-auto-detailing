import type { Metadata } from "next";
import type { ReactNode } from "react";
import { brandConfig } from "@/config/brand";

// No client-side session gate: every /admin route renders the static closed page until P1-06.
export const metadata: Metadata = {
  title: `Staff Portal | ${brandConfig.businessName}`,
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
