import "server-only";

// P1-07 admin queue and booking API services. Every function authorizes the caller inside the
// service (fail closed) and validates its input with the admin Zod schemas.
export { getDayQueues, listBookings, searchBookings, getBookingDetail, listBays, getCaps } from "./reads";
export {
  setBookingStatus, finishBooking, declineBooking, moveBooking, reorderQueueDay, addLine, removeLine, setLineStatus, setLinePrice, setBay, notifyCustomer,
} from "./bookings-write";
export { createBay, updateBay, setDefaultCap, setCapOverride, deleteCapOverride } from "./settings-write";
export { getSchedule, setWeekHours, addClosedDate, removeClosedDate, getCalendar } from "./schedule";
export { lookupCustomerHistory } from "./history";
export type { StaffActor, AdminOptions } from "./context";

export { getDayBoard } from "./board";
export { assignWorker, unassignWorker } from "./workers-write";
export { setDepositStatus, readDepositProof } from "./deposit";
export { deleteBooking } from "./delete-booking";
export { listTeam, getPerson, addPerson, updatePerson, removePreview, removePerson } from "./team";
export { getCommissionSettings, setDefaultRate, listCommissions, setCommissionsPaid, repairCommissions, adjustCommission } from "./commissions";
export { listSupplies, addSupply, updateSupply, recordStock, removeSupply, restoreSupply, listMovements } from "./supplies";
export { listContainers, addContainer, updateContainer, removeContainer, moveBay } from "./containers";
export { getExpenseMonth, addExpense, updateExpense, removeExpense, restoreExpense, listExpenseHistory, listExpenseCategories, addExpenseCategory, updateExpenseCategory } from "./expenses";
export { expenseTotals, type ExpenseTotals } from "./expenses-read";
export { getAnalytics } from "./analytics";
