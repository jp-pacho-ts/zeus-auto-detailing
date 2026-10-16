"use client";

import * as React from "react";
import { Wrench } from "lucide-react";
import { Dialog, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { brandConfig } from "@/config/brand";

export function CalendarTab() {
  const [selectedDay, setSelectedDay] = React.useState<number>(18);
  const [overrideModalOpen, setOverrideModalOpen] = React.useState<boolean>(false);
  const [overrideBay, setOverrideBay] = React.useState<string>("Bay 01");
  const [overrideReason, setOverrideReason] = React.useState<string>("Equipment calibration");
  const [overrides, setOverrides] = React.useState<string[]>([
    "Bay 02 blocked: Rotary polisher maintenance (Oct 19)",
  ]);

  const handleAddOverride = (e: React.FormEvent) => {
    e.preventDefault();
    setOverrides((prev) => [
      ...prev,
      `${overrideBay} blocked: ${overrideReason} (Oct ${selectedDay})`,
    ]);
    setOverrideModalOpen(false);
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Bay Schedule Panel */}
      <div className="space-y-4 lg:col-span-8">
        <div className="rounded border border-border bg-[#121214] p-6">
          <div className="flex items-center justify-between border-b border-border pb-4">
            <div>
              <h2 className="text-base font-bold text-foreground">
                Bay Schedule · Oct {selectedDay}, 2026
              </h2>
              <p className="text-xs text-muted-foreground">
                Real-time bay assignments and cure monitoring
              </p>
            </div>
            <span className="rounded bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">
              {brandConfig.defaultBays} Bays Operating
            </span>
          </div>

          {/* Bay 01 */}
          <div className="flex flex-col gap-3 border-b border-border py-4 sm:flex-row sm:items-center">
            <span className="w-20 font-bold text-sm text-muted-foreground">
              Bay 01
            </span>
            <div className="flex flex-1 flex-wrap gap-3">
              <div className="rounded border-l-4 border-primary bg-[#18181b] p-3 text-xs">
                <p className="font-bold text-foreground">08:00 · Marco V.</p>
                <p className="text-muted-foreground">Signature 9H Graphene (6.0h)</p>
              </div>
              <div className="rounded border-l-4 border-blue-400 bg-[#18181b] p-3 text-xs">
                <p className="font-bold text-foreground">02:30 · Anton R.</p>
                <p className="text-muted-foreground">Multi-Stage Polish (4.0h)</p>
              </div>
            </div>
          </div>

          {/* Bay 02 */}
          <div className="flex flex-col gap-3 border-b border-border py-4 sm:flex-row sm:items-center">
            <span className="w-20 font-bold text-sm text-muted-foreground">
              Bay 02
            </span>
            <div className="flex flex-1 flex-wrap gap-3">
              <div className="rounded border-l-4 border-primary bg-[#18181b] p-3 text-xs">
                <p className="font-bold text-foreground">10:00 · Janelle C.</p>
                <p className="text-muted-foreground">Exterior Wash & Seal (1.5h)</p>
              </div>
              <div className="rounded border-l-4 border-primary bg-[#18181b] p-3 text-xs">
                <p className="font-bold text-foreground">01:00 · Sofia D.</p>
                <p className="text-muted-foreground">Full Interior Deep Clean (3.0h)</p>
              </div>
            </div>
          </div>

          {/* Capacity Override */}
          <div className="mt-6 flex flex-col justify-between gap-4 rounded border border-border bg-[#18181b] p-4 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3">
              <Wrench className="h-5 w-5 text-primary" />
              <div>
                <p className="text-xs font-bold text-foreground">Capacity Override</p>
                <p className="text-xs text-muted-foreground">
                  Block a bay for maintenance or special arrangements.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOverrideModalOpen(true)}
              className="inline-flex min-h-[40px] items-center justify-center rounded border border-primary/40 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10"
            >
              + Add Override
            </button>
          </div>

          {overrides.length > 0 && (
            <div className="mt-4 border-t border-border pt-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-primary">
                Active Shop Overrides
              </p>
              <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                {overrides.map((ov, idx) => (
                  <p key={idx}>• {ov}</p>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mini Calendar Panel */}
      <div className="lg:col-span-4">
        <div className="rounded border border-border bg-[#121214] p-6">
          <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
            <h3 className="text-sm font-bold text-foreground">October 2026</h3>
            <span className="text-xs text-muted-foreground">Day Selector</span>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-xs">
            {Array.from({ length: 31 }, (_, i) => {
              const day = i + 1;
              const isToday = day === selectedDay;
              return (
                <button
                  type="button"
                  key={day}
                  onClick={() => setSelectedDay(day)}
                  className={`flex h-9 w-full items-center justify-center rounded font-medium transition-colors ${
                    isToday
                      ? "bg-primary text-primary-foreground font-bold"
                      : "text-zinc-300 hover:bg-[#18181b]"
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Override Modal */}
      <Dialog open={overrideModalOpen} onOpenChange={setOverrideModalOpen}>
        <DialogHeader>
          <DialogTitle>Add Shop Capacity Override</DialogTitle>
          <DialogDescription>
            Temporarily adjust bay schedule for October {selectedDay}, 2026.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleAddOverride} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase text-muted-foreground">
              Select Bay
            </label>
            <select
              value={overrideBay}
              onChange={(e) => setOverrideBay(e.target.value)}
              className="mt-1 w-full rounded border border-border bg-[#18181b] p-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value="Bay 01">Bay 01</option>
              <option value="Bay 02">Bay 02</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase text-muted-foreground">
              Override Reason
            </label>
            <input
              type="text"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              className="mt-1 w-full rounded border border-border bg-[#18181b] p-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              required
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOverrideModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="gold">
              Save Override
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
