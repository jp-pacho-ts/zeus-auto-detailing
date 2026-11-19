/** Public configuration only. Keep credentials and private settings in server environment variables. */
export const brandConfig = {
  businessName: "Zeus Auto Detailing",
  shortName: "Zeus Detailing",
  shopName: "Zeus Auto Detailing",
  tagline: "Precision paint restoration and ceramic protection.",
  description:
    "Tacloban's dedicated auto detailing shop specializing in multi-stage paint correction and graphene ceramic coatings.",
  location: "Brgy 95 Caibaan, Tacloban City",
  locationFull:
    "Maharlika Highway Corner Villa Mayor, Brgy 95 Caibaan, Tacloban City, Philippines, 6500",
  address:
    "Maharlika Highway Corner Villa Mayor Brgy 95 Caibaan, Tacloban City, Philippines, 6500",
  shopAddress:
    "Maharlika Highway Corner Villa Mayor Brgy 95 Caibaan, Tacloban City, Philippines, 6500",
  landmark: "Corner Villa Mayor, Maharlika Highway",
  mapCoordinates: "11.2054621,124.991338",
  // Google Maps Share > Embed a map for the shop's verified listing.
  mapEmbedUrl: "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3913.7589542850656!2d124.99133800000001!3d11.2054621!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x330877f0a9e2c48f%3A0x7e38b176ace74446!2sZeus%20Carwash%20and%20Detailing%20Tacloban!5e0!3m2!1sen!2sph!4v1795064097394!5m2!1sen!2sph",
  supportPhone: "+63 930 016 2234",
  contactPhone: "+63 930 016 2234",
  displayPhone: "0930 016 2234",
  operatingHours: "MON — SUN · 08:00 AM — 06:00 PM",
  operatingSchedule: "Monday – Sunday, 08:00 AM – 06:00 PM daily",
  openTime: "08:00",
  closeTime: "18:00",
  facebook: "Zeus Auto Detailing Tacloban",
  facebookMessengerUrl: "https://m.me/zeusautodetailingtacloban",
  facebookPageUrl: "https://www.facebook.com/zeusautodetailingtacloban",
  instagram: "https://www.instagram.com/zeus.otodetailing",
  instagramHandle: "@zeus.otodetailing",
  currency: "PHP",
  currencySymbol: "₱",
  timezone: "Asia/Manila",
  defaultBays: 2,
  bayCapacity: 2,
  locale: "en-PH",
  logoUrl: "/images/logo.png",
  logoLightUrl: "/images/logo-light.png",
  // P1-18 optional deposit: the shop's own accounts (LE-supplied). Customers pay outside the system
  // and may send a screenshot; nothing here computes or moves money.
  payment: {
    accounts: [
      {
        provider: "GCash",
        accountName: "Junel Colinayo",
        numberLabel: "GCash number",
        number: "09300162234",
        qrImage: "/images/payment/gcash-qr.png",
      },
      {
        provider: "GoTyme Bank",
        accountName: "Junel Colinayo",
        numberLabel: "Account number",
        number: "013659818218",
        qrImage: "/images/payment/gotyme-qr.png",
      },
    ],
  },
  theme: {
    colors: {
      background: "#09090b",
      foreground: "#f5f5f4",
      card: "#18181b",
      "card-foreground": "#f5f5f4",
      popover: "#18181b",
      "popover-foreground": "#f5f5f4",
      muted: "#121214",
      "muted-foreground": "#a1a1aa",
      secondary: "#18181b",
      "secondary-foreground": "#a1a1aa",
      border: "#27272a",
      input: "#a1a1aa",
      primary: "#c08818",
      "primary-foreground": "#09090b",
      accent: "#d49b28",
      "accent-foreground": "#09090b",
      "primary-hover": "#d49b28",
      ring: "#c08818",
      success: "#10b981",
      warning: "#d49b28",
      destructive: "#ef4444",
      "destructive-foreground": "#f5f5f4",
    },
    radius: "0.5rem",
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
  },
} as const;

export type BrandConfig = typeof brandConfig;
