import * as React from "react";

// The one card shell every Settings section uses (2026-11-24): icon, title and a line of intro, then the controls.
export function SectionCard({
  id,
  icon: Icon,
  title,
  intro,
  danger = false,
  children,
}: {
  id: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  title: string;
  intro: React.ReactNode;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={id + "-title"}
      className={"rounded-xl border bg-panel p-5 shadow-sm sm:p-6 " + (danger ? "border-rose-500/40" : "border-border")}
    >
      <div className="flex items-start gap-3 border-b border-border/70 pb-4">
        <div className={"flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-raised " + (danger ? "border-rose-500/40 text-rose-400" : "border-border text-primary")}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          {/* tabIndex -1: Settings moves focus here when a section is chosen. */}
          <h2 id={id + "-title"} tabIndex={-1} className="text-base font-bold tracking-tight text-foreground outline-none">{title}</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{intro}</p>
        </div>
      </div>
      <div className="mt-5 space-y-4">{children}</div>
    </section>
  );
}
