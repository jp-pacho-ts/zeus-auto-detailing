import "server-only";

// P1-07 admin queue and booking API services. Every function authorizes the caller inside the
// service (fail closed) and validates its input with the admin Zod schemas.
export { getDayQueues, listBookings, searchBookings, getBookingDetail, listBays, getCaps } from "./reads";
export {
  setBookingStatus, declineBooking, moveBooking, reorderQueueDay, addLine, removeLine, setLineStatus, setLinePrice, setBay, notifyCustomer,
} from "./bookings-write";
export { createBay, updateBay, setDefaultCap, setCapOverride, deleteCapOverride } from "./settings-write";
export { getSchedule, setWeekHours, addClosedDate, removeClosedDate, getCalendar } from "./schedule";
export { lookupCustomerHistory } from "./history";
export type { StaffActor, AdminOptions } from "./context";

export { getDayBoard } from "./board";
export { assignWorker, unassignWorker } from "./workers-write";
export { setDepositStatus, readDepositProof } from "./deposit";
export { deleteBooking } from "./delete-booking";
