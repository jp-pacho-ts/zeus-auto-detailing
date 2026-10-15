"use client";

import * as React from "react";
import { Droplets } from "lucide-react";
import { Dialog, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface InventoryItem {
  id: string;
  name: string;
  category: string;
  stockQty: number;
  maxQty: number;
  unit: string;
  status: "healthy" | "low";
}

const INITIAL_INVENTORY: InventoryItem[] = [
  {
    id: "gtechniq-csu",
    name: "Gtechniq Crystal Serum Ultra 9H",
    category: "Graphene & Ceramic Coating",
    stockQty: 8,
    maxQty: 12,
    unit: "bottles",
    status: "healthy",
  },
  {
    id: "carpro-essence",
    name: "CarPro Essence Primer Polish",
    category: "Compound & Polish",
    stockQty: 3,
    maxQty: 8,
    unit: "bottles",
    status: "low",
  },
  {
    id: "lake-country-pads",
    name: "Lake Country Foam Pads (Orange / White)",
    category: "Machine Correction Pads",
    stockQty: 24,
    maxQty: 30,
    unit: "pieces",
    status: "low",
  },
  {
    id: "koch-chemie-green",
    name: "Koch Chemie Green Star APC",
    category: "Interior Cleaner & Degreaser",
    stockQty: 16,
    maxQty: 18,
    unit: "bottles",
    status: "healthy",
  },
  {
    id: "carpro-iron-x",
    name: "CarPro Iron X Decontamination Spray",
    category: "Iron Fallout Decontamination",
    stockQty: 5,
    maxQty: 10,
    unit: "bottles",
    status: "low",
  },
];

export function InventoryTab() {
  const [items, setItems] = React.useState<InventoryItem[]>(INITIAL_INVENTORY);
  const [addModalOpen, setAddModalOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [stockQty, setStockQty] = React.useState(10);
  const [maxQty, setMaxQty] = React.useState(15);
  const [unit, setUnit] = React.useState("bottles");

  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const ratio = stockQty / maxQty;
    const status: "healthy" | "low" = ratio < 0.4 ? "low" : "healthy";

    setItems((prev) => [
      ...prev,
      {
        id: `item-${Date.now()}`,
        name,
        category,
        stockQty,
        maxQty,
        unit,
        status,
      },
    ]);

    setName("");
    setCategory("");
    setAddModalOpen(false);
  };

  return (
    <div className="rounded border border-border bg-[#121214]">
      <div className="flex items-center justify-between border-b border-border p-6">
        <div>
          <h2 className="text-base font-bold text-foreground">
            Consumables & Chemical Inventory
          </h2>
          <p className="text-xs text-muted-foreground">
            Detailing fluids, ceramic formulas, and buffing pad stock levels
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAddModalOpen(true)}
          className="inline-flex min-h-[40px] items-center justify-center rounded border border-primary/40 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10"
        >
          + Add Consumable
        </button>
      </div>

      <div className="divide-y divide-border">
        {items.map((item) => {
          const percentage = Math.min(
            100,
            Math.round((item.stockQty / item.maxQty) * 100),
          );

          return (
            <div
              key={item.id}
              className="flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-center hover:bg-[#18181b]/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-primary/10 text-primary">
                  <Droplets className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-bold text-sm text-foreground">{item.name}</p>
                  <p className="text-xs text-muted-foreground">{item.category}</p>
                </div>
              </div>

              <div className="flex items-center gap-6">
                <div className="w-32">
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>{item.stockQty} {item.unit}</span>
                    <span>{percentage}%</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-[#18181b] overflow-hidden">
                    <div
                      className={`h-full ${item.status === "low" ? "bg-rose-500" : "bg-primary"}`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>

                <span
                  className={`inline-block rounded px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                    item.status === "low"
                      ? "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                      : "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                  }`}
                >
                  {item.status === "low" ? "Low Stock" : "Sufficient"}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={addModalOpen} onOpenChange={setAddModalOpen}>
        <DialogHeader>
          <DialogTitle>Add Consumable Item</DialogTitle>
          <DialogDescription>
            Register chemicals, pads, and ceramic coatings for inventory tracking.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleAddItem} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase text-muted-foreground">
              Item Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. CarPro Dlux Wheel Coating"
              className="mt-1 w-full rounded border border-border bg-[#18181b] p-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase text-muted-foreground">
              Category
            </label>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Ceramic Coating"
              className="mt-1 w-full rounded border border-border bg-[#18181b] p-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              required
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase text-muted-foreground">
                In Stock
              </label>
              <input
                type="number"
                value={stockQty}
                onChange={(e) => setStockQty(Number(e.target.value))}
                min={0}
                className="mt-1 w-full rounded border border-border bg-[#18181b] p-2.5 text-sm text-foreground"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase text-muted-foreground">
                Max Stock
              </label>
              <input
                type="number"
                value={maxQty}
                onChange={(e) => setMaxQty(Number(e.target.value))}
                min={1}
                className="mt-1 w-full rounded border border-border bg-[#18181b] p-2.5 text-sm text-foreground"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase text-muted-foreground">
                Unit
              </label>
              <input
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="mt-1 w-full rounded border border-border bg-[#18181b] p-2.5 text-sm text-foreground"
              />
            </div>
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
              Save Item
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
