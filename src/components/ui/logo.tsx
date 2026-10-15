import * as React from "react";
import Image from "next/image";
import { brandConfig } from "@/config/brand";

export function Logo({
  small = false,
  className = "",
  priority = false,
}: {
  small?: boolean;
  className?: string;
  priority?: boolean;
}) {
  const height = small ? 28 : 36;
  const width = Math.round(height * (715 / 275));

  return (
    <div className={`inline-flex items-center select-none ${className}`}>
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
