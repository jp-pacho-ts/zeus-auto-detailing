// User settings pure model: validation, preferences, and theme constants.
export type AdminThemeMode = "dark" | "light" | "system";

export const THEME_STORAGE_KEY = "zeus_admin_theme";
export const AUDIO_NOTIFICATION_KEY = "zeus_admin_audio_notifications";

export interface ThemeOption {
  id: AdminThemeMode;
  title: string;
  description: string;
  badge?: string;
}

export const THEME_OPTIONS: readonly ThemeOption[] = [
  {
    id: "dark",
    title: "Obsidian Dark",
    description: "Low-glare dark palette with gold accents, optimized for shop bays.",
    badge: "Recommended",
  },
  {
    id: "light",
    title: "Daylight Crisp",
    description: "Bright high-contrast palette for direct sunlight and outdoor workstations.",
  },
  {
    id: "system",
    title: "System Synchronized",
    description: "Automatically match your operating system theme.",
  },
];

export interface PasswordValidationResult {
  valid: boolean;
  field?: "currentPassword" | "newPassword" | "confirmPassword";
  error?: string;
}

export function validatePasswordInput(
  currentPassword: string,
  newPassword: string,
  confirmPassword: string,
): PasswordValidationResult {
  if (!currentPassword.trim()) {
    return { valid: false, field: "currentPassword", error: "Enter your current password." };
  }
  if (newPassword.length < 15) {
    return {
      valid: false,
      field: "newPassword",
      error: "New password must be at least 15 characters long.",
    };
  }
  if (newPassword === currentPassword) {
    return {
      valid: false,
      field: "newPassword",
      error: "New password must be different from your current password.",
    };
  }
  if (newPassword !== confirmPassword) {
    return { valid: false, field: "confirmPassword", error: "New passwords do not match." };
  }
  return { valid: true };
}

export function formatTimeRemaining(expiryIso: string, now: Date = new Date()): string {
  try {
    const expiry = new Date(expiryIso).getTime();
    const diffMs = expiry - now.getTime();
    if (diffMs <= 0) return "Expired";
    const minutes = Math.floor(diffMs / 60_000);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) {
      const remainingMinutes = minutes % 60;
      return `${hours}h ${remainingMinutes}m`;
    }
    return `${Math.max(1, minutes)}m`;
  } catch {
    return "Active";
  }
}

export function resolveEffectiveTheme(mode: AdminThemeMode, systemPrefersDark: boolean): "dark" | "light" {
  if (mode === "system") {
    return systemPrefersDark ? "dark" : "light";
  }
  return mode;
}
