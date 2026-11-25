import type { CatalogServiceKind } from "@/types/catalog-contracts";

// LE 2026-11-20: each service will get its own page; until then these routes show a branded "coming soon" page.
// Category pages work without the catalog; a catalog service slug also resolves (checked on the server).
export const CATEGORY_PAGES = {
  wash: { kind: "WASH", title: "Wash", photo: "basic-wash" },
  detailing: { kind: "DETAILING", title: "Detailing", photo: "exterior-detailing" },
  "graphene-coating": { kind: "GRAPHENE", title: "Graphene coating", photo: "eclipse-graphene" },
} as const satisfies Record<string, { kind: CatalogServiceKind; title: string; photo: string }>;
export type CategoryPage = keyof typeof CATEGORY_PAGES;

export const CATEGORY_LABEL: Record<CatalogServiceKind, string> = {
  WASH: "Wash", DETAILING: "Detailing", GRAPHENE: "Graphene coating", TINT: "Window tint", PPF: "Paint protection film", REPAINT: "Repaint",
};

export const servicePage = (slug: string) => `/preview/services/${encodeURIComponent(slug)}`;

// Own keys only, so a slug such as "constructor" never resolves to an Object prototype member.
export const categoryPage = (slug: string) => Object.hasOwn(CATEGORY_PAGES, slug) ? CATEGORY_PAGES[slug as CategoryPage] : undefined;
