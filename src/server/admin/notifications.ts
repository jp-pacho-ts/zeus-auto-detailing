import "server-only";
import { withStaffDb, type StaffTx } from "@/server/auth/db-admission";
import { manilaToday } from "@/server/availability-core";
import type {
  AdminNotificationItem,
  AdminNotificationSummary,
} from "@/types/admin-contracts";
import { addDays, authorize, type AdminOptions, type StaffActor } from "./context";

function read<T>(
  options: AdminOptions,
  work: (tx: StaffTx) => Promise<T>,
): Promise<T> {
  return withStaffDb("STAFF_READ", work, {
    access: "read",
    db: options.db,
    signal: options.signal,
  });
}

function getMondayOfWeek(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00.000Z");
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(dateStr, diff);
}

export async function getAdminNotifications(
  actor: StaffActor,
  options: AdminOptions = {},
): Promise<AdminNotificationSummary> {
  authorize(actor, "READ");

  return read(options, async (tx) => {
    const notifications: AdminNotificationItem[] = [];
    const now = new Date();
    const todayStr = manilaToday(now);
    const tomorrowStr = addDays(todayStr, 1);
    const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

    // 1. New Bookings (placed in the last 48 hours)
    const newBookings = await tx.booking.findMany({
      where: {
        createdAt: { gte: twoDaysAgo },
        status: { in: ["PENDING", "CONFIRMED"] },
      },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: {
        lineItems: {
          where: { removedAt: null },
          select: { nameSnapshot: true },
          take: 2,
        },
      },
    });

    for (const b of newBookings) {
      const services = b.lineItems.map((l) => l.nameSnapshot).join(", ") || "Detailing Package";
      const bookDateStr = b.bookingDate.toISOString().slice(0, 10);
      const isPending = b.status === "PENDING";
      notifications.push({
        id: `new-booking-${b.id}`,
        type: "NEW_BOOKING",
        title: `New Booking · ${b.customerName}`,
        message: `${services} booked for ${bookDateStr}${isPending ? " (Pending confirmation)" : ""}.`,
        targetTab: "Bookings",
        targetId: b.id,
        severity: isPending ? "warning" : "info",
        timestamp: b.createdAt.toISOString(),
      });
    }

    // 2. Upcoming Bookings (Today & Tomorrow in Manila)
    const todayStart = new Date(todayStr + "T00:00:00.000Z");
    const tomorrowEnd = new Date(tomorrowStr + "T23:59:59.999Z");
    const upcomingBookings = await tx.booking.findMany({
      where: {
        bookingDate: { gte: todayStart, lte: tomorrowEnd },
        status: { in: ["CONFIRMED", "IN_PROGRESS", "PENDING"] },
      },
      orderBy: [{ bookingDate: "asc" }, { createdAt: "asc" }],
      take: 8,
      include: {
        lineItems: {
          where: { removedAt: null },
          select: { nameSnapshot: true },
          take: 2,
        },
      },
    });

    for (const b of upcomingBookings) {
      // Don't duplicate if already shown in new bookings
      if (notifications.some((n) => n.targetId === b.id)) continue;
      const services = b.lineItems.map((l) => l.nameSnapshot).join(", ") || "Scheduled Service";
      const bookDateStr = b.bookingDate.toISOString().slice(0, 10);
      const isToday = bookDateStr === todayStr;
      notifications.push({
        id: `upcoming-booking-${b.id}`,
        type: "UPCOMING_BOOKING",
        title: `${isToday ? "Today's Booking" : "Tomorrow's Booking"} · ${b.customerName}`,
        message: `${services} · Status: ${b.status}`,
        targetTab: "Bay board",
        targetId: b.id,
        severity: isToday ? "urgent" : "info",
        timestamp: b.bookingDate.toISOString(),
      });
    }

    // 3. Low Supplies & Out of Stock Alerts
    const supplies = await tx.supplyItem.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        unit: true,
        currentStock: true,
        reorderLevel: true,
        updatedAt: true,
      },
    });

    for (const s of supplies) {
      if (s.currentStock === 0) {
        notifications.push({
          id: `supply-out-${s.id}`,
          type: "LOW_SUPPLY",
          title: `Out of Stock: ${s.name}`,
          message: `Zero ${s.unit}s remaining. Reorder needed immediately.`,
          targetTab: "Supplies & Inventory",
          targetId: s.id,
          severity: "urgent",
          timestamp: s.updatedAt.toISOString(),
        });
      } else if (s.reorderLevel > 0 && s.currentStock <= s.reorderLevel) {
        notifications.push({
          id: `supply-low-${s.id}`,
          type: "LOW_SUPPLY",
          title: `Low Stock: ${s.name}`,
          message: `Only ${s.currentStock} ${s.unit}${s.currentStock === 1 ? "" : "s"} left (Reorder alert at ≤ ${s.reorderLevel}).`,
          targetTab: "Supplies & Inventory",
          targetId: s.id,
          severity: "warning",
          timestamp: s.updatedAt.toISOString(),
        });
      }
    }

    // 4. Payroll Payout Approaching (Friday through Sunday)
    const manilaDayOfWeek = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      weekday: "short",
    }).format(now);

    if (["Fri", "Sat", "Sun"].includes(manilaDayOfWeek)) {
      const currentMonday = getMondayOfWeek(todayStr);
      const adjustments = await tx.staffPayrollAdjustment.findMany({
        where: { weekStart: new Date(currentMonday + "T00:00:00.000Z") },
        select: { staffId: true, isPaid: true },
      });

      const paidStaffIds = new Set(
        adjustments.filter((a) => a.isPaid).map((a) => a.staffId),
      );

      const activeDetailers = await tx.staff.count({
        where: { isActive: true, role: "DETAILER" },
      });

      const unpaidCount = Math.max(0, activeDetailers - paidStaffIds.size);

      if (unpaidCount > 0) {
        const isSunday = manilaDayOfWeek === "Sun";
        notifications.push({
          id: `payroll-alert-${currentMonday}`,
          type: "PAYROLL_ALERT",
          title: isSunday ? "Sunday Payroll: Payout Night" : "Payroll Approaching",
          message: isSunday
            ? `${unpaidCount} team member${unpaidCount === 1 ? "" : "s"} awaiting payout disbursement tonight.`
            : `Sunday payroll disbursement is approaching. ${unpaidCount} team member${unpaidCount === 1 ? "" : "s"} pending review.`,
          targetTab: "Payroll & Commissions",
          severity: isSunday ? "urgent" : "warning",
          timestamp: now.toISOString(),
        });
      }
    }

    // Sort notifications: urgent first, then warning, then info; within same severity, newest first
    const severityRank = { urgent: 0, warning: 1, info: 2 };
    notifications.sort((a, b) => {
      const rankDiff = severityRank[a.severity] - severityRank[b.severity];
      if (rankDiff !== 0) return rankDiff;
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    return {
      unreadCount: notifications.length,
      items: notifications,
    };
  });
}
