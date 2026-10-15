"use client";

import * as React from "react";
import { Dialog, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface Detailer {
  initials: string;
  name: string;
  role: string;
  commission: string;
  jobs: string;
}

const INITIAL_DETAILERS: Detailer[] = [
  {
    initials: "JM",
    name: "Jorge Mendoza",
    role: "Lead Detailer & Coating Specialist",
    commission: "₱12,450",
    jobs: "4 jobs",
  },
  {
    initials: "AR",
    name: "Alex Ramos",
    role: "Paint Correction Specialist",
    commission: "₱8,200",
    jobs: "3 jobs",
  },
  {
    initials: "LC",
    name: "Luis Cruz",
    role: "Interior Restoration Technician",
    commission: "₱6,750",
    jobs: "5 jobs",
  },
  {
    initials: "MD",
    name: "Mark Diaz",
    role: "Wash & Prep Specialist",
    commission: "₱4,500",
    jobs: "6 jobs",
  },
];

export function DetailersTab() {
  const [detailers, setDetailers] = React.useState<Detailer[]>(INITIAL_DETAILERS);
  const [addModalOpen, setAddModalOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState("Detailing Specialist");

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const parts = name.trim().split(" ");
    const initials =
      parts.length > 1
        ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
        : name.slice(0, 2).toUpperCase();

    setDetailers((prev) => [
      ...prev,
      {
        initials,
        name,
        role,
        commission: "₱0",
        jobs: "0 jobs",
      },
    ]);
    setName("");
    setAddModalOpen(false);
  };

  return (
    <div className="rounded border border-border bg-[#121214]">
      <div className="flex items-center justify-between border-b border-border p-6">
        <div>
          <h2 className="text-base font-bold text-foreground">
            Technician Roster & Commissions
          </h2>
          <p className="text-xs text-muted-foreground">
            Weekly job tracking and earned commission payouts
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAddModalOpen(true)}
          className="inline-flex min-h-[40px] items-center justify-center rounded border border-primary/40 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10"
        >
          + Add Detailer
        </button>
      </div>

      <div className="divide-y divide-border">
        {detailers.map((d) => (
          <div
            key={d.name}
            className="flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-center hover:bg-[#18181b]/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
                {d.initials}
              </div>
              <div>
                <p className="font-bold text-sm text-foreground">{d.name}</p>
                <p className="text-xs text-muted-foreground">{d.role}</p>
              </div>
            </div>

            <div className="flex items-center gap-6">
              <div className="text-left sm:text-right">
                <span className="text-xs font-semibold text-foreground">
                  {d.jobs}
                </span>
                <span className="block text-[10px] text-muted-foreground">
                  This Week
                </span>
              </div>

              <div className="text-left sm:text-right">
                <span className="text-sm font-bold tabular-nums text-foreground">
                  {d.commission}
                </span>
                <span className="block text-[10px] text-muted-foreground">
                  Earned Commission
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={addModalOpen} onOpenChange={setAddModalOpen}>
        <DialogHeader>
          <DialogTitle>Add Detailer</DialogTitle>
          <DialogDescription>
            Register a technician to assign bay operations and calculate commission rates.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleAdd} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase text-muted-foreground">
              Full Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Rafael Gomez"
              className="mt-1 w-full rounded border border-border bg-[#18181b] p-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase text-muted-foreground">
              Specialization / Role
            </label>
            <input
              type="text"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. Paint Correction Specialist"
              className="mt-1 w-full rounded border border-border bg-[#18181b] p-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              required
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setAddModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="gold">
              Add Technician
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
