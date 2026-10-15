import { brandConfig } from "@/config/brand";

export interface ServiceItem {
  id: string;
  name: string;
  discipline: string;
  disciplineOrder: number;
  price: number;
  mins: number;
  durationLabel: string;
  tag: string;
  desc: string;
  features: string[];
  multiplierNote: string;
}

export interface VehicleItem {
  id: string;
  name: string;
  icon: string;
  category: string;
  multiplier: number;
  typicalBayTimeAddMinutes: number;
}

export const services: ServiceItem[] = [
  // 1. Ceramic Coatings & Surface Protection
  {
    id: "signature-9h-graphene",
    name: "Signature 9H Graphene Ceramic Coating",
    discipline: "Ceramic Coatings & Surface Protection",
    disciplineOrder: 1,
    price: 18500,
    mins: 360,
    durationLabel: "6.0 Hours",
    tag: "Flagship Protection",
    desc: "Molecular-bonded graphene matrix delivering extreme contact-angle water beading, chemical resistance, and rich optical depth.",
    features: [
      "Chemical decontamination & surface clay bar extraction",
      "Single-stage precision preparation machine polish",
      "Dual-coat 9H graphene formulation applied by certified technician",
      "24-month hydrophobic surface performance warranty",
    ],
    multiplierNote: "Base rate on Sedan; larger panels require extended cure and bay time.",
  },
  {
    id: "three-year-ceramic-shield",
    name: "3-Year Commercial Ceramic Shield",
    discipline: "Ceramic Coatings & Surface Protection",
    disciplineOrder: 1,
    price: 24500,
    mins: 480,
    durationLabel: "8.0 Hours (Full Day)",
    tag: "Maximum Durability",
    desc: "Ultra-dense multi-layer silica protection formulated to resist environmental fallout, acid rain etching, and harsh tropical UV exposure.",
    features: [
      "Full exterior paint audit with digital ultrasonic depth gauge",
      "Multi-stage prep compounding and optical refinement polish",
      "Base bonding coat plus hydrophobic fluoropolymer top coat",
      "3-year durability guarantee with biannual inspection checkups",
    ],
    multiplierNote: "Requires full day exclusive bay dedication.",
  },

  // 2. Paint Correction & Clarity
  {
    id: "multi-stage-paint-correction",
    name: "Multi-Stage Paint Correction & Polish",
    discipline: "Paint Correction & Clarity",
    disciplineOrder: 2,
    price: 8500,
    mins: 240,
    durationLabel: "4.0 Hours",
    tag: "Surface Restoration",
    desc: "Precision rotary and dual-action machine compounding to eliminate swirl marks, light scratching, water etching, and clearcoat haze.",
    features: [
      "Panel-by-panel paint defect inspection under 5000K daylight lighting",
      "Heavy-cut micro-abrasive compound to level clearcoat imperfections",
      "Jeweling polish stage for true mirror-like reflection and depth",
      "Application of synthetic ceramic sealant protection",
    ],
    multiplierNote: "Final time depends on factory clearcoat hardness and surface severity.",
  },

  // 3. Interior Deep Restoration
  {
    id: "full-interior-deep-clean",
    name: "Full Interior Deep Clean & Sanitize",
    discipline: "Interior Deep Restoration",
    disciplineOrder: 3,
    price: 4500,
    mins: 180,
    durationLabel: "3.0 Hours",
    tag: "Cabin Revival",
    desc: "A meticulous hygienic reset of every cabin surface utilizing high-temperature dry steam, hot-water carpet extraction, and anti-microbial treatments.",
    features: [
      "High-pressure compressed air purging of seams, rails, and crevices",
      "Hot water extraction of fabric seats, carpets, and floor mats",
      "pH-neutral gentle scrub and matte conditioning of leather upholstery",
      "Ozone generator anti-bacterial cabin fogging for odor elimination",
    ],
    multiplierNote: "High-spill or mold contamination may require additional extraction time.",
  },

  // 4. Maintenance & Detail Wash
  {
    id: "premium-exterior-wash-seal",
    name: "Premium Exterior Wash & Hydrophobic Seal",
    discipline: "Maintenance & Detail Wash",
    disciplineOrder: 4,
    price: 1800,
    mins: 90,
    durationLabel: "1.5 Hours",
    tag: "Essential Care",
    desc: "A scratch-free two-bucket hand wash process featuring wheel barrel decontamination, iron deposit dissolution, and spray silica sealant.",
    features: [
      "Pre-wash pH-neutral snow foam bath to lift surface grit safely",
      "Dedicated wheel face, barrel, and brake caliper agitation",
      "Chemical iron fallout decontamination on clearcoat and wheels",
      "High-gloss 90-day hydrophobic spray sealant application",
    ],
    multiplierNote: "Standard slot allocation across morning and afternoon operating hours.",
  },
];

export const vehicles: VehicleItem[] = [
  {
    id: "sedan",
    name: "Sedan / Hatchback",
    icon: "▱",
    category: "Standard Compact & Mid-size",
    multiplier: 1.0,
    typicalBayTimeAddMinutes: 0,
  },
  {
    id: "suv",
    name: "SUV / Crossover",
    icon: "▰",
    category: "Compact & Mid-size SUV",
    multiplier: 1.15,
    typicalBayTimeAddMinutes: 30,
  },
  {
    id: "pickup",
    name: "Pickup / Van / Full SUV",
    icon: "▰",
    category: "Trucks, Large Vans & 7-Seaters",
    multiplier: 1.25,
    typicalBayTimeAddMinutes: 60,
  },
  {
    id: "motorcycle",
    name: "Motorcycle / Specialty",
    icon: "◒",
    category: "Big Bikes & Specialty Units",
    multiplier: 0.7,
    typicalBayTimeAddMinutes: -30,
  },
];

export function calculateEstimatedPrice(basePrice: number, multiplier: number): number {
  return Math.round((basePrice * multiplier) / 100) * 100;
}

export function calculateEstimatedMinutes(baseMinutes: number, addMinutes: number): number {
  return Math.max(45, baseMinutes + addMinutes);
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  if (hours > 0 && remainingMins > 0) {
    return `${hours}h ${remainingMins}m`;
  }
  if (hours > 0) {
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `${remainingMins} mins`;
}

export function formatCurrency(amount: number): string {
  return `${brandConfig.currencySymbol}${amount.toLocaleString(brandConfig.locale)}`;
}
