"use client";

import * as React from "react";
import { MetricCard } from "./metric-card";

interface BookingRecord {
  id: string;
  client: string;
  service: string;
  appointment: string;
  status: "PENDING" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  amount: string;
}

const INITIAL_BOOKINGS: BookingRecord[] = [
  {
    id: "ZEUS-849201",
    client: "Marco Villanueva",
    service: "Signature 9H Graphene Ceramic Coating",
    appointment: "Oct 18, 2026 · 8:00 AM",
    status: "CONFIRMED",
    amount: "₱18,500",
  },
  {
    id: "ZEUS-849198",
    client: "Janelle Cruz",
    service: "Premium Exterior Wash & Hydrophobic Seal",
    appointment: "Oct 18, 2026 · 10:00 AM",
    status: "PENDING",
    amount: "₱1,800",
  },
  {
    id: "ZEUS-849176",
    client: "Anton Reyes",
    service: "Multi-Stage Paint Correction & Polish",
    appointment: "Oct 17, 2026 · 1:00 PM",
    status: "IN_PROGRESS",
    amount: "₱8,500",
  },
  {
    id: "ZEUS-849104",
    client: "Sofia Dela Peña",
    service: "Full Interior Deep Clean & Sanitize",
    appointment: "Oct 16, 2026 · 9:30 AM",
    status: "COMPLETED",
    amount: "₱4,500",
  },
  {
    id: "ZEUS-849092",
    client: "Carlo Santos",
    service: "Signature 9H Graphene Ceramic Coating",
    appointment: "Oct 15, 2026 · 8:00 AM",
    status: "COMPLETED",
    amount: "₱18,500",
  },
  {
    id: "ZEUS-849081",
    client: "Bea Mendoza",
    service: "Premium Exterior Wash & Hydrophobic Seal",
    appointment: "Oct 15, 2026 · 2:00 PM",
    status: "CANCELLED",
    amount: "₱1,800",
  },
];

const FILTERS = [
  "ALL",
  "PENDING",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;

type FilterType = (typeof FILTERS)[number];

export function BookingsTab() {
  const [filter, setFilter] = React.useState<FilterType>("ALL");

  const filteredBookings = React.useMemo(() => {
    if (filter === "ALL") return INITIAL_BOOKINGS;
    return INITIAL_BOOKINGS.filter((b) => b.status === filter);
  }, [filter]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          title="Today's Bookings"
          value="08"
          meta="+2 from yesterday"
        />
        <MetricCard
          title="Expected Revenue"
          value="₱46,800"
          meta="4 confirmed appointments"
        />
        <MetricCard
          title="Bay Utilization"
          value="75%"
          meta="1 bay available"
        />
        <MetricCard
          title="Pending Action"
          value="03"
          meta="Needs staff confirmation"
        />
      </div>

      <div className="rounded border border-border bg-[#121214]">
        <div className="flex flex-col justify-between gap-4 border-b border-border p-4 sm:flex-row sm:items-center">
          <div className="text-sm font-bold text-foreground">
            All Appointments{" "}
            <span className="ml-1 text-xs text-primary">
              ({filteredBookings.length})
            </span>
          </div>

          <div
            role="tablist"
            aria-label="Booking status filter"
            className="flex flex-wrap gap-1.5"
          >
            {FILTERS.map((f) => (
              <button
                type="button"
                key={f}
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={`rounded px-3 py-1 text-xs font-semibold transition-colors ${
                  filter === f
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-[#18181b] hover:text-foreground"
                }`}
              >
                {f.replace("_", " ")}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-[#18181b] text-muted-foreground">
              <tr>
                <th className="p-4 font-semibold uppercase tracking-wider">Reference</th>
                <th className="p-4 font-semibold uppercase tracking-wider">Client</th>
                <th className="p-4 font-semibold uppercase tracking-wider">Treatment</th>
                <th className="p-4 font-semibold uppercase tracking-wider">Appointment</th>
                <th className="p-4 font-semibold uppercase tracking-wider">Status</th>
                <th className="p-4 font-semibold uppercase tracking-wider text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredBookings.map((b) => (
                <tr key={b.id} className="hover:bg-[#18181b]/50">
                  <td className="p-4 font-mono font-bold text-primary">{b.id}</td>
                  <td className="p-4 font-medium text-foreground">{b.client}</td>
                  <td className="p-4 text-muted-foreground">{b.service}</td>
                  <td className="p-4 text-muted-foreground">{b.appointment}</td>
                  <td className="p-4">
                    <span
                      className={`inline-block rounded px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        b.status === "CONFIRMED" || b.status === "COMPLETED"
                          ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                          : b.status === "PENDING"
                          ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                          : b.status === "IN_PROGRESS"
                          ? "bg-blue-500/15 text-blue-400 border border-blue-500/30"
                          : "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                      }`}
                    >
                      {b.status.replace("_", " ")}
                    </span>
                  </td>
                  <td className="p-4 text-right font-semibold tabular-nums text-foreground">
                    {b.amount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
