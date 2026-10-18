// Next.js runs register() once per server process, as the server starts. Staff authentication's
// required configuration is checked here, so a bad production deploy refuses to start (and the
// previous deployment keeps serving) instead of failing at the first sign-in.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { refuseStartupOnInvalidConfiguration } = await import("@/server/auth/startup");
  refuseStartupOnInvalidConfiguration();
  const { refuseBookingStartupOnInvalidConfiguration } = await import("@/server/bookings-startup");
  refuseBookingStartupOnInvalidConfiguration();
}
