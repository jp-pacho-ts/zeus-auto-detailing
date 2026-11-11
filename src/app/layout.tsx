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
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(window.location.pathname.startsWith('/admin')){var t=localStorage.getItem("zeus_admin_theme");if(t==="light"||(t==="system"&&!window.matchMedia("(prefers-color-scheme: dark)").matches)){document.documentElement.classList.remove("dark");document.documentElement.classList.add("light");return;}}document.documentElement.classList.remove("light");document.documentElement.classList.add("dark");}catch(e){}})()`,
          }}
        />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
