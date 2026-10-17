// Home page service list from docs/client/service-catalog.md (P1-09). Names and inclusions only:
// prices, durations and per-service booking links wait for the P1-02 catalog service.
export interface ServiceMenuItem {
  name: string;
  tag: string;
  desc?: string;
}

export interface ServiceMenuGroup {
  name: string;
  note?: string;
  services: ServiceMenuItem[];
}

export const SERVICE_MENU: readonly ServiceMenuGroup[] = [
  {
    name: "Premium Carwash",
    services: [
      { name: "Basic Wash", tag: "Wash", desc: "Wash, vacuum and tire black." },
      { name: "Signature Wash", tag: "Wash", desc: "Basic Wash plus sanitize." },
      { name: "Premium Wash", tag: "Wash", desc: "Signature Wash plus wax." },
      { name: "Glass Acid Rain Removal", tag: "Add-on", desc: "Added to a wash." },
      { name: "Bac to Zero", tag: "Add-on", desc: "Added to a wash." },
    ],
  },
  {
    name: "Auto Detailing",
    services: [
      { name: "Interior Detailing", tag: "Detailing" },
      { name: "Exterior Detailing", tag: "Detailing" },
      { name: "Engine Detailing", tag: "Detailing" },
      { name: "Full Detailing", tag: "Detailing" },
      { name: "Headlight Restoration", tag: "Restoration" },
    ],
  },
  {
    name: "Graphene Coating",
    note:
      "All three packages include 5 stages of graphene-reinforced coating, paint decontamination and surface preparation, full exterior detailing, paint correction, acid rain removal, clay bar treatment, paint enhancement polish and basic interior cleaning.",
    services: [
      { name: "IGC Eclipse Graphene", tag: "9H · 3-year warranty", desc: "Package 1 by Intergalactic Chemicals." },
      { name: "IGL Arcane Graphene", tag: "9H · 4-year warranty", desc: "Package 2 by IGL Coatings." },
      { name: "IGL Kenzo Graphene", tag: "10H · 5-year warranty", desc: "Package 3 by IGL Coatings." },
      { name: "Motorcycle Graphene", tag: "Motorcycle", desc: "Graphene coating for motorcycles." },
    ],
  },
  {
    name: "Window Tint",
    services: [
      { name: "Nano Ceramic Tint", tag: "Nexus NEX 6S" },
      { name: "Sputtered Tint", tag: "Nexus 80R" },
      { name: "Regular Tint", tag: "Tint" },
    ],
  },
  {
    name: "Paint Protection Film",
    services: [
      { name: "PrimeShield TPU 7.5 mil", tag: "PPF", desc: "Thermoplastic polyurethane paint protection film." },
      { name: "PrimeShield TPU 8.0 mil", tag: "PPF", desc: "Thermoplastic polyurethane paint protection film." },
    ],
  },
  {
    name: "Repaint",
    services: [
      { name: "Panel Repaint", tag: "Repaint", desc: "Repaint of individual panels." },
      { name: "Washover Repaint", tag: "Repaint", desc: "Full-body repaint." },
    ],
  },
];
