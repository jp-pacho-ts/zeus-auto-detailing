"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ChevronLeft,
  ShieldCheck,
  Mail,
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { brandConfig } from "@/config/brand";
import { Logo } from "@/components/ui/logo";

// Messages per status code. 401 uses the server's specific text if provided.
const ERRORS: Record<number, string> = {
  400: "Please enter your staff email and password.",
  403: "This sign-in session is out of date. Please reload and try again.",
  429: "Too many sign-in attempts. Please wait a minute before retrying.",
  503: "Sign-in is temporarily unavailable. Please try again shortly.",
};

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [identifier, setIdentifier] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [isLight] = React.useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("light"),
  );

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!identifier.trim() || password.length === 0) {
      setError("Please enter your staff email and password.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: identifier, password }),
        credentials: "same-origin",
        cache: "no-store",
      });

      if (response.ok) {
        await response.json().catch(() => null);
        setPassword("");
        router.replace(next);
        return;
      }

      let message =
        ERRORS[response.status] ?? "We couldn't sign you in. Please verify your credentials.";
      if (response.status === 401) {
        const body = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        message = body?.error?.message ?? message;
      }
      setError(message);
    } catch {
      setError("Couldn't reach the shop server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex h-full w-full min-h-screen flex-col items-center justify-center overflow-y-auto bg-[#09090b] px-4 py-12 text-[#f5f5f4] selection:bg-primary selection:text-black">
      {/* Ambient background glows */}
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_50%_0%,rgba(192,136,24,0.12),transparent_70%)]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 h-96 w-96 rounded-full bg-primary/10 blur-[120px]"
        aria-hidden="true"
      />

      <div className="relative z-10 w-full max-w-[420px]">
        {/* Brand Header */}
        <div className="mb-8 flex flex-col items-center text-center">
          <Link
            href="/"
            aria-label="Return to public site"
            className="group inline-flex min-h-[44px] items-center transition-transform hover:scale-[1.02]"
          >
            <Logo priority mode={isLight ? "light" : "dark"} />
          </Link>
          <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-[11px] font-semibold text-primary">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Authorized Staff Portal</span>
          </div>
        </div>

        {/* Card Container */}
        <div className="rounded-2xl border border-white/10 bg-[#121214]/95 p-7 sm:p-9 shadow-2xl backdrop-blur-xl ring-1 ring-white/5">
          <div className="mb-6">
            <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
              Sign In
            </h1>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              Access {brandConfig.shortName} operations, bay board, calendar schedule, and customer records.
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            {/* Identifier field */}
            <div>
              <label
                htmlFor="staff-identifier"
                className="block text-xs font-semibold text-zinc-300"
              >
                Staff Email or Username
              </label>
              <div className="relative mt-1.5">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-zinc-500">
                  <Mail className="h-4 w-4" aria-hidden="true" />
                </div>
                <input
                  id="staff-identifier"
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="name@zeusauto.ph"
                  autoComplete="username"
                  required
                  className="flex min-h-[44px] w-full rounded-xl border border-zinc-800 bg-[#18181b] pl-10 pr-3.5 py-2.5 text-xs text-foreground placeholder:text-zinc-600 transition-colors focus:border-primary focus:bg-[#1c1c20] focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            {/* Password field */}
            <div>
              <label
                htmlFor="staff-password"
                className="block text-xs font-semibold text-zinc-300"
              >
                Password
              </label>
              <div className="relative mt-1.5">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-zinc-500">
                  <Lock className="h-4 w-4" aria-hidden="true" />
                </div>
                <input
                  id="staff-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  autoComplete="current-password"
                  required
                  className="flex min-h-[44px] w-full rounded-xl border border-zinc-800 bg-[#18181b] pl-10 pr-11 py-2.5 text-xs text-foreground placeholder:text-zinc-600 transition-colors focus:border-primary focus:bg-[#1c1c20] focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 flex min-h-[44px] min-w-[44px] items-center justify-center text-zinc-500 hover:text-zinc-300 transition-colors focus:outline-none focus:text-primary"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-400"
              >
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span className="leading-relaxed">{error}</span>
              </div>
            )}

            {/* Submit Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={loading}
                className="group relative flex min-h-[46px] w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-black transition-all hover:bg-primary-hover hover:shadow-[0_0_20px_rgba(192,136,24,0.3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    <span>Signing in...</span>
                  </>
                ) : (
                  <>
                    <span>Sign In to Dashboard</span>
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Card Footer */}
          <div className="mt-6 border-t border-zinc-800/80 pt-5 text-center">
            <Link
              href="/"
              className="inline-flex min-h-[44px] items-center gap-1.5 text-xs text-zinc-400 hover:text-foreground transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Return to public website</span>
            </Link>
          </div>
        </div>

        {/* Security watermark footer */}
        <p className="mt-6 text-center text-[11px] text-zinc-600">
          Protected shop system · {brandConfig.location} · {brandConfig.timezone}
        </p>
      </div>
    </div>
  );
}
