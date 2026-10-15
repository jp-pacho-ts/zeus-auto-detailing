import * as React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?:
    | "default"
    | "gold"
    | "secondary"
    | "success"
    | "warning"
    | "destructive"
    | "outline";
}

export function Badge({
  className,
  variant = "default",
  ...props
}: BadgeProps) {
  const variantStyles = {
    default: "bg-primary text-primary-foreground",
    gold: "bg-[#c08818]/15 text-[#c08818] border border-[#c08818]/30",
    secondary: "bg-secondary text-secondary-foreground",
    success: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
    warning: "bg-amber-500/15 text-amber-400 border border-amber-500/30",
    destructive: "bg-rose-500/15 text-rose-400 border border-rose-500/30",
    outline: "text-foreground border border-border",
  }[variant];

  return (
    <div
      className={cn(
        "inline-flex items-center rounded px-2.5 py-0.5 text-xs font-semibold tracking-wide transition-colors",
        variantStyles,
        className,
      )}
      {...props}
    />
  );
}
