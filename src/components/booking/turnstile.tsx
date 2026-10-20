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

export function TurnstileChallenge({
  siteKey,
  onToken,
}: {
  siteKey: string;
  onToken: (token: string) => void;
}) {
  const box = React.useRef<HTMLDivElement>(null);
  const callback = React.useRef(onToken);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    callback.current = onToken;
  }, [onToken]);
  React.useEffect(() => {
    let widget: string | undefined;
    let cancelled = false;
    loadTurnstile()
      .then(() => {
        if (cancelled || !box.current || !window.turnstile) return;
        widget = window.turnstile.render(box.current, {
          sitekey: siteKey,
          action: "booking_create",
          theme: "dark",
          callback: (token: string) => callback.current(token),
          "expired-callback": () => callback.current(""),
          "error-callback": () => callback.current(""),
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (widget && window.turnstile) window.turnstile.remove(widget);
    };
  }, [siteKey]);
  return (
    <div>
      <div ref={box} />
      {failed && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          The security check could not load. Check your connection and refresh the page.
        </p>
      )}
    </div>
  );
}
