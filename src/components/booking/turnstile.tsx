"use client";

import * as React from "react";

// Cloudflare Turnstile in explicit-render mode. The token is single use: the wizard remounts this
// component (new key) after every definitive server answer to get a fresh one.
declare global {
  interface Window {
    turnstile?: {
      render(element: HTMLElement, options: Record<string, unknown>): string;
      remove(widgetId: string): void;
    };
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<void> | null = null;

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error("Security check unavailable"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

// P1-19 W5: the wizard is told the check's state so a disabled Submit can say why.
export type ChallengeStatus = "pending" | "ready" | "expired" | "failed";

export function TurnstileChallenge({
  siteKey,
  onToken,
  onStatus,
  size = "normal",
}: {
  siteKey: string;
  onToken: (token: string) => void;
  onStatus?: (status: ChallengeStatus) => void;
  // "compact" below 360 px wide: the normal widget is a fixed 300 px (L9, no sideways scroll).
  size?: "normal" | "compact";
}) {
  const box = React.useRef<HTMLDivElement>(null);
  const callback = React.useRef(onToken);
  const status = React.useRef(onStatus);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    callback.current = onToken;
    status.current = onStatus;
  }, [onToken, onStatus]);
  React.useEffect(() => {
    let widget: string | undefined;
    let cancelled = false;
    status.current?.("pending");
    loadTurnstile()
      .then(() => {
        if (cancelled || !box.current || !window.turnstile) return;
        widget = window.turnstile.render(box.current, {
          sitekey: siteKey,
          action: "booking_create",
          theme: "dark",
          size,
          callback: (token: string) => {
            callback.current(token);
            status.current?.("ready");
          },
          "expired-callback": () => {
            callback.current("");
            status.current?.("expired");
          },
          "error-callback": () => {
            callback.current("");
            status.current?.("failed");
          },
        });
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        status.current?.("failed");
      });
    return () => {
      cancelled = true;
      if (widget && window.turnstile) window.turnstile.remove(widget);
    };
  }, [siteKey, size]);
  return (
    <div>
      <div ref={box} />
      {failed && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          The security check could not load. Check your connection and refresh the page.
        </p>
      )}
    </div>
  );
}
