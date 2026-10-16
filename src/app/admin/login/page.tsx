"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ChevronLeft, Gauge } from "lucide-react";
import { brandConfig } from "@/config/brand";
import { Logo } from "@/components/ui/logo";

export default function AdminLoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!identifier.trim() || !password.trim()) {
      setError("Please enter your staff email and password.");
      return;
    }

    setLoading(true);

    setTimeout(() => {
      if (typeof window !== "undefined") {
        sessionStorage.setItem("zeus_staff_auth", "true");
        sessionStorage.setItem("zeus_staff_user", identifier);
      }
      router.push("/admin");
    }, 400);
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#09090b] px-4 py-12 text-[#f5f5f4]">
      <div className="mb-8">
        <Link href="/" aria-label="Return to public site" className="inline-flex min-h-[44px] items-center">
          <Logo />
        </Link>
      </div>

      <div className="w-full max-w-md rounded border border-border bg-[#121214] p-8 shadow-sm">
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded bg-primary/10 text-primary">
          <Gauge className="h-6 w-6" />
        </div>

        <div className="mb-6 rounded border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-200">
          <p className="font-semibold">Demo Access — Authentication is in demonstration mode for evaluation.</p>
          <p className="mt-1 text-amber-300/90 leading-relaxed">
            Enter any email and password to access the administrative portal. Production credentials and role-based guards will be connected in Phase 5.
          </p>
        </div>

        <p className="text-xs font-semibold uppercase tracking-wider text-primary">
          {brandConfig.businessName} · Shop Staff
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
          Shop Management
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sign in to manage bay scheduling, team commissions, and supplies inventory.
        </p>

        <form onSubmit={handleLogin} className="mt-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Staff Email or ID
            </label>
            <input
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="manager@zeusauto.ph"
              autoComplete="username"
              className="mt-1 flex min-h-[44px] w-full rounded border border-border bg-[#18181b] px-3.5 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              className="mt-1 flex min-h-[44px] w-full rounded border border-border bg-[#18181b] px-3.5 py-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              required
            />
          </div>

          {error && <p className="text-xs font-medium text-rose-400">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {loading ? "Signing in..." : "Sign In to Shop Management"}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </form>

        <div className="mt-6 border-t border-border pt-4 text-center">
          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back to public shop site
          </Link>
        </div>
      </div>
    </div>
  );
}
