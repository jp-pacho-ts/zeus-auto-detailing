import { brandConfig } from "@/config/brand";

// Tailwind uses RGB channels so opacity utilities work with the configured hex colors.
export function createBrandThemeVariables(): Record<string, string> {
  const colors = Object.fromEntries(
    Object.entries(brandConfig.theme.colors).map(([token, hex]) => [
      "--brand-" + token,
      [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)).join(" "),
    ]),
  );

  return {
    ...colors,
    "--brand-radius": brandConfig.theme.radius,
    "--brand-font-sans": brandConfig.theme.fontFamily,
  };
}
