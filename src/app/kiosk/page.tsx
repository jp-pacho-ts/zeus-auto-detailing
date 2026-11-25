import type { Metadata } from "next";
import { Kiosk } from "./kiosk";

export const metadata: Metadata = {
  title: "Zeus Auto Detailing Kiosk",
  manifest: "/kiosk/manifest.webmanifest",
  robots: { index: false, follow: false },
};

export default function KioskPage() {
  return <Kiosk />;
}
