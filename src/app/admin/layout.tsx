import type { Metadata } from "next";
import type { ReactNode } from "react";
import { brandConfig } from "@/config/brand";

// No session gate here: layouts do not re-run on client navigation, so every admin page
// calls requireStaffPage() itself, and every admin service repeats its own guard.
export const metadata: Metadata = {
  title: `Staff Portal | ${brandConfig.businessName}`,
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
