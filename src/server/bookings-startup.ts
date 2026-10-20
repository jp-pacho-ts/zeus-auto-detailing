import "server-only";
import { parseBookingConfiguration } from "./bookings-credentials";
import { startBookingNotifications } from "./notifications/bookings";
export function checkBookingStartup(env: Record<string, string | undefined> = process.env): void { parseBookingConfiguration(env); }
export function refuseBookingStartupOnInvalidConfiguration(): void {
    try {
        checkBookingStartup();
    }
    catch {
        console.error(JSON.stringify({ event: "booking.config_invalid" }));
        process.exit(1);
    }
    startBookingNotifications();
}
