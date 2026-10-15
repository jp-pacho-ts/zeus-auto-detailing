import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import { brandConfig } from "@/config/brand";
import { createBrandThemeVariables } from "@/lib/brand-theme";
import "./globals.css";

export const metadata: Metadata = {
  title: brandConfig.businessName + " | " + brandConfig.location,
  description: brandConfig.description + " in " + brandConfig.location + ".",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang={brandConfig.locale}
      className="dark"
      style={createBrandThemeVariables() as CSSProperties}
    >
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
