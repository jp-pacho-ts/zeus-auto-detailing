import * as React from "react";
import Image from "next/image";
import { brandConfig } from "@/config/brand";

export function Logo({
  small = false,
  className = "",
  priority = false,
  mode = "auto",
}: {
  small?: boolean;
  className?: string;
  priority?: boolean;
  mode?: "auto" | "dark" | "light";
}) {
  const height = small ? 28 : 36;
  const width = Math.round(height * (715 / 275));

  if (mode === "dark") {
    return (
      <div className={`inline-flex min-h-[44px] items-center select-none ${className}`}>
        <Image
          src="/images/logo.png"
          alt={brandConfig.businessName}
          width={width}
          height={height}
          priority={priority}
          className="h-auto w-auto object-contain"
          style={{ maxHeight: small ? "28px" : "36px" }}
        />
      </div>
    );
  }

  if (mode === "light") {
    return (
      <div className={`inline-flex min-h-[44px] items-center select-none ${className}`}>
        <Image
          src="/images/logo-light.png"
          alt={brandConfig.businessName}
          width={width}
          height={height}
          priority={priority}
          className="h-auto w-auto object-contain"
          style={{ maxHeight: small ? "28px" : "36px" }}
        />
      </div>
    );
  }

  return (
    <div className={`inline-flex min-h-[44px] items-center select-none ${className}`}>
      {/* Light mode logo (black subtext) */}
      <Image
        src="/images/logo-light.png"
        alt={brandConfig.businessName}
        width={width}
        height={height}
        priority={priority}
        className="h-auto w-auto object-contain block dark:hidden"
        style={{ maxHeight: small ? "28px" : "36px" }}
      />
      {/* Dark mode logo (white subtext) */}
      <Image
        src="/images/logo.png"
        alt={brandConfig.businessName}
        width={width}
        height={height}
        priority={priority}
        className="h-auto w-auto object-contain hidden dark:block"
        style={{ maxHeight: small ? "28px" : "36px" }}
      />
    </div>
  );
}
