"use client";

import * as React from "react";
import { MetricCard } from "./metric-card";
import { services } from "@/config/catalog";

export function AnalyticsTab() {
  const chartBars = [45, 62, 40, 70, 54, 82, 68, 93, 73, 88, 77, 100];
  const popularCounts = [12, 8, 7];
  const popularPercentages = [44, 29, 27];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard
          title="Gross Revenue · October"
          value="₱184,500"
          meta="+18.4% vs September"
        />
        <MetricCard
          title="Bay Utilization"
          value="82.4%"
          meta="Target: 75%"
        />
        <MetricCard
          title="Average Ticket"
          value="₱6,820"
          meta="+₱940 vs last month"
        />
        <MetricCard
          title="Completed Jobs"
          value="27"
          meta="This month"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Revenue Chart Panel */}
        <div className="rounded border border-border bg-[#121214] p-6 lg:col-span-8">
          <div className="flex items-center justify-between border-b border-border pb-4">
            <div>
              <h2 className="text-base font-bold text-foreground">
                Revenue Overview
              </h2>
              <p className="text-xs text-muted-foreground">
                Daily studio revenue trend across 2 bays
              </p>
            </div>
            <span className="text-xs text-muted-foreground">Last 30 Days</span>
          </div>

          <div
            className="flex h-56 items-end gap-3 pt-6"
            aria-label="30-day revenue trend chart"
          >
            {chartBars.map((height, i) => (
              <div
                key={i}
                className="flex flex-1 flex-col items-center justify-end gap-2 h-full"
              >
                <div
                  className="w-full max-w-[28px] rounded-t bg-primary transition-all hover:bg-primary-hover"
                  style={{ height: `${height}%` }}
                  title={`Day ${i + 1}: ${height}% capacity`}
                />
                <span className="text-[10px] text-muted-foreground">{i + 1}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Popular Treatments Panel */}
        <div className="rounded border border-border bg-[#121214] p-6 lg:col-span-4">
          <div className="border-b border-border pb-4">
            <h2 className="text-base font-bold text-foreground">
              Popular Treatments
            </h2>
            <p className="text-xs text-muted-foreground">
              Booking share by discipline
            </p>
          </div>

          <div className="divide-y divide-border pt-2">
            {services.slice(0, 3).map((s, i) => (
              <div key={s.id} className="flex items-center justify-between py-4">
                <div>
                  <p className="font-bold text-xs text-foreground">{s.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {popularCounts[i]} bookings this month
                  </p>
                </div>
                <span className="text-base font-extrabold text-primary tabular-nums">
                  {popularPercentages[i]}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
