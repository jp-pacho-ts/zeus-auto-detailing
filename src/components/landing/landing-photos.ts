// Shop photos for the service cards (P1-88 17.13, UI/UX rulings on the CEO picks, 2026-11-16).
// One photo per service it shows, never a whole category; a service without an entry keeps the "Photo coming soon" frame.
// Keyed by catalog slug, which the public projection already carries; files are 4:3 1600x1200 WebP in public/media/landing,
// re-encoded from the shop's photos with no EXIF, GPS, XMP or ICC data (sources, crops and blur: P1-88 implementation handoff).
// position: the 4:5 card crop (UI/UX identity 5.2, tested on each derivative); contain: shown whole on a dark mat (Kenzo kit).
export type LandingPhoto = { src: string; alt: string; position?: string; contain?: true };

export const LANDING_PHOTOS: Record<string, LandingPhoto> = {
  "basic-wash": { src: "/media/landing/basic-wash.webp", alt: "Zeus detailer drying a blue sedan's roof with a microfiber towel", position: "55% 35%" },
  "signature-wash": { src: "/media/landing/signature-wash.webp", alt: "Gloved hand drying a blue sedan beside the tail light" },
  "exterior-detailing": { src: "/media/landing/exterior-detailing.webp", alt: "Detailer machine-polishing the front fender of a white pickup" },
  "full-detailing": { src: "/media/landing/full-detailing.webp", alt: "Detailer machine-polishing the hood of a white pickup" },
  "eclipse-graphene": { src: "/media/landing/eclipse.webp", alt: "Detailer applying coating to a white pickup's hood with an applicator block", position: "40% 40%" },
  "arcane-graphene": { src: "/media/landing/arcane.webp", alt: "Gloved detailer wiping coating across a white pickup's hood", position: "35% 40%" },
  "kenzo-graphene": { src: "/media/landing/kenzo.webp", alt: "Kenzo coating kit: base and top bottles, Strip panel-prep spray, applicator and card", contain: true },
};

// Own keys only: a staff-set slug such as "constructor" or "__proto__" must not resolve to an Object prototype member.
export const landingPhoto = (slug: string) => Object.hasOwn(LANDING_PHOTOS, slug) ? LANDING_PHOTOS[slug] : undefined;
