// Pure choice of the homepage background video file. No DOM access, so it is unit-tested and safe to import anywhere.
export const HERO_VIDEO_FILES = {
  desktop: "/media/home/hero-1080.mp4",
  phone: "/media/home/hero-720.mp4",
} as const;

export const HERO_POSTER_FILES = {
  desktop: "/media/home/hero-poster.jpg",
  phone: "/media/home/hero-poster-720.jpg",
} as const;

/** Widest viewport (CSS px) that gets the lighter 720p file and poster. Keep in step with the media query in the styles. */
export const HERO_PHONE_MAX_WIDTH = 800;

export type HeroVideoInput = {
  width: number;
  reducedMotion: boolean;
  saveData: boolean;
  effectiveType: string | undefined;
};

/** Returns the file to load, or null when only the poster should show (reduced motion, data-saver, 2G). */
export function chooseHeroVideo({ width, reducedMotion, saveData, effectiveType }: HeroVideoInput): string | null {
  if (reducedMotion || saveData) return null;
  if (effectiveType === "slow-2g" || effectiveType === "2g") return null;
  return width <= HERO_PHONE_MAX_WIDTH ? HERO_VIDEO_FILES.phone : HERO_VIDEO_FILES.desktop;
}
