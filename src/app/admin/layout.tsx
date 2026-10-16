"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";

function useStaffAuth(): boolean {
  return React.useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener("storage", onStoreChange);
      return () => window.removeEventListener("storage", onStoreChange);
    },
    () => sessionStorage.getItem("zeus_staff_auth") === "true",
    () => false,
  );
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const isAuthenticated = useStaffAuth();

  React.useEffect(() => {
    if (pathname !== "/admin/login" && !isAuthenticated) {
      router.replace("/admin/login");
    }
  }, [pathname, isAuthenticated, router]);

  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#09090b] text-[#f59e0b]">
        <div className="flex items-center gap-3 text-sm tracking-wider uppercase font-semibold">
          <span className="inline-block h-3 w-3 animate-ping rounded-full bg-[#f59e0b]" />
          Verifying shop staff session...
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
