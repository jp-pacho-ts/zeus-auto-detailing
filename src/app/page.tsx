import { ComingSoon } from "@/components/home/coming-soon";
import OriginalHomePage from "@/components/home/coming-soon-original";

// P1-21: set true in a reviewed release to restore the complete original homepage.
// Its server-controlled PAUSED/OPEN CTA is preserved; other routes are unaffected.
const RESTORE_ORIGINAL_HOMEPAGE = false;

export default function HomePage() {
  return RESTORE_ORIGINAL_HOMEPAGE ? <OriginalHomePage /> : <ComingSoon />;
}
