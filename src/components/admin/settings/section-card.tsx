import * as React from "react";

// 2026-11-25 (LE, Vercel reference): the section's title heads the page, and each setting is its own card:
// title, one line of description, the control, then a footer strip with a hint on the left and the action on the right.

// The page heading of a Settings section. tabIndex -1: choosing a section moves focus here.
export function SettingsHeader({ id, title, intro }: { id: string; title: string; intro: React.ReactNode }) {
  return (
    <header className="mb-6">
      <h2 id={id + "-title"} tabIndex={-1} className="text-xl font-bold tracking-tight text-foreground outline-none sm:text-2xl">
        {title}
      </h2>
      <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-muted-foreground">{intro}</p>
    </header>
  );
}

export function SettingsCard({
  id,
  title,
  description,
  children,
  hint,
  action,
  danger = false,
}: {
  id?: string;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  /** Left side of the footer strip: a short note, a count, or the save result. */
  hint?: React.ReactNode;
  /** Right side of the footer strip: the card's button. */
  action?: React.ReactNode;
  danger?: boolean;
}) {
  const titleId = (id ?? title.toLowerCase().replace(/[^a-z0-9]+/g, "-")) + "-card-title";
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className={"overflow-hidden rounded-xl border bg-panel shadow-sm " + (danger ? "border-rose-500/40" : "border-border")}
    >
      <div className="p-5 sm:p-6">
        <h3 id={titleId} className="text-base font-semibold tracking-tight text-foreground">{title}</h3>
        {description && <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>}
        {children && <div className={description ? "mt-5" : "mt-4"}>{children}</div>}
      </div>
      {(hint || action) && (
        <div
          data-settings-card-footer
          className={
            "flex min-h-[60px] flex-wrap items-center justify-between gap-3 border-t px-5 py-3 sm:px-6 " +
            (danger ? "border-rose-500/30 bg-rose-500/[0.06]" : "border-border bg-background/60")
          }
        >
          <div className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">{hint}</div>
          {action && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
        </div>
      )}
    </section>
  );
}
