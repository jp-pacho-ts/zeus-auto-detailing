import "server-only";
// P1-19 W2: the home page's booking calls to action follow the server's pause switch. It is read
// when the page renders on the server (no API or contract change); Railway applies a changed
// ONLINE_BOOKING_MODE with a redeploy, so the built page always matches the running mode.
export const onlineBookingPaused = (env: Record<string, string | undefined> = process.env) => env.ONLINE_BOOKING_MODE === "PAUSED";
