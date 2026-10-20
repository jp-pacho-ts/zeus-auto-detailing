import "server-only";
import { parseHistoryKeyRing } from "./history-key-ring";

// D7: refuse the server before accepting traffic; errors never contain key material.
export function refuseAdminStartupOnInvalidConfiguration(): void {
  try { parseHistoryKeyRing(process.env); } catch {
    console.error(JSON.stringify({ event: "admin.config_invalid" }));
    process.exit(1);
  }
}
