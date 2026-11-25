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
import "@/components/landing/landing.css";
import "./login.css";

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

  React.useEffect(() => {
    document.documentElement.classList.remove("light");
    document.documentElement.classList.add("dark");
  }, []);

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
    <div className="landing login">
      <div className="login-media">
        {/* Same approved shop photo as the landing closing band; decorative here. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/media/landing/full-detailing.webp" alt="" width="1600" height="1200" decoding="async" />
        <span className="landing-word" aria-hidden="true">ZEUS</span>
        <p className="login-media-caption">Car and motorcycle detailing in Tacloban City</p>
      </div>

      <main className="login-panel">
        <Link href="/" aria-label="Return to public site" className="login-home">
          <Logo priority />
        </Link>

        <span className="login-badge">
          <ShieldCheck aria-hidden="true" />
          Authorized staff portal
        </span>
        <h1>Staff sign in</h1>
        <p className="login-lede landing-muted">
          Access {brandConfig.shortName} operations, bay board, calendar schedule, and customer records.
        </p>

        <form onSubmit={handleLogin} className="login-form">
          <div>
            <label htmlFor="staff-identifier">Staff Email or Username</label>
            <div className="login-input">
              <Mail aria-hidden="true" />
              <input
                id="staff-identifier"
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="name@zeusauto.ph"
                autoComplete="username"
                required
              />
            </div>
          </div>

          <div>
            <label htmlFor="staff-password">Password</label>
            <div className="login-input">
              <Lock aria-hidden="true" />
              <input
                id="staff-password"
                className="login-has-toggle"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="login-toggle"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </button>
            </div>
          </div>

          {error && (
            <div role="alert" className="login-error">
              <AlertCircle aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <button type="submit" disabled={loading} className="landing-pill landing-gold login-submit">
            {loading ? (
              <>
                <Loader2 className="login-spin" aria-hidden="true" />
                <span>Signing in...</span>
              </>
            ) : (
              <>
                <span>Sign in to dashboard</span>
                <ArrowRight aria-hidden="true" />
              </>
            )}
          </button>
        </form>

        <Link href="/" className="login-back">
          <ChevronLeft aria-hidden="true" />
          Return to public website
        </Link>

        <p className="login-foot landing-muted">
          Protected shop system · {brandConfig.location} · {brandConfig.timezone}
        </p>
      </main>
    </div>
  );
}
