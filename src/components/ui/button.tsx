import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "gold" | "outline" | "ghost" | "secondary" | "destructive";
  size?: "default" | "sm" | "lg" | "icon";
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    const variantStyles = {
      default: "bg-primary text-primary-foreground hover:bg-primary-hover font-bold",
      gold: "bg-[#c08818] text-[#09090b] hover:bg-[#d49b28] font-bold",
      outline: "border border-border bg-[#18181b] text-foreground hover:border-zinc-700 hover:text-foreground",
      ghost: "bg-transparent text-foreground hover:bg-[#18181b] hover:text-foreground",
      secondary: "bg-secondary text-secondary-foreground hover:bg-[#27272a]",
      destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
    }[variant];

    const sizeStyles = {
      default: "h-11 px-4 py-2",
      sm: "h-9 rounded px-3 text-xs",
      lg: "h-12 rounded px-6 text-base",
      icon: "h-11 w-11",
    }[size];

    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded text-sm transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
          "disabled:pointer-events-none disabled:opacity-50 min-h-[44px]",
          variantStyles,
          sizeStyles,
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
