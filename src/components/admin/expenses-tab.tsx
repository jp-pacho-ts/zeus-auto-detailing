"use client";

import * as React from "react";
import type { UserRole } from "@/types/contracts";
import type { AdminExpenseCategory, AdminExpenseMonth } from "@/types/admin-contracts";
import { LoadState } from "./bookings/use-admin-resource";
import { periodRange, type AnalyticsPeriod } from "./analytics/analytics-model";
import { shopDate } from "./bookings/model";
import { ExpensesPanel } from "./expenses/expenses-panel";
import { NOT_ADMIN_TEXT } from "./expenses/expenses-model";
import { useKeptResource } from "./team/use-kept-resource";

// Expenses are money: for admins only. The server refuses everyone else, and this screen says so plainly first and fetches nothing.
export function ExpensesTab({ role }: { role: UserRole }) {
  const isAdmin = role === "ADMIN";
  const thisMonth = shopDate().slice(0, 7);
  const [period, setPeriod] = React.useState<AnalyticsPeriod>(() => periodRange("THIS_MONTH", shopDate()));
  const month = period.from.slice(0, 7);
  const setMonth = (value: string) => setPeriod(periodRange("THIS_MONTH", value + "-01"));
  const [categoryId, setCategoryId] = React.useState("");
  const [includeRemoved, setIncludeRemoved] = React.useState(false);
  const query = `month=${month}&from=${period.from}&to=${period.to}&includeRemoved=${includeRemoved}${categoryId ? `&categoryId=${categoryId}` : ""}`;
  const data = useKeptResource<AdminExpenseMonth>(isAdmin ? `/api/admin/expenses?${query}` : null);
  const categories = useKeptResource<AdminExpenseCategory[]>(isAdmin ? "/api/admin/expense-categories" : null);

  if (!isAdmin) return <div className="rounded border border-border bg-panel p-6 text-sm text-muted-foreground">{NOT_ADMIN_TEXT}</div>;

  return (
    <div className="space-y-4">
      <LoadState loading={data.loading} error={data.error} retry={data.reload} />
      <LoadState loading={categories.loading} error={categories.error} retry={categories.reload} />
      {data.data && categories.data && (
        <ExpensesPanel
          period={period} setPeriod={setPeriod} data={data.data} categories={categories.data} query={query} thisMonth={thisMonth} setMonth={setMonth} categoryId={categoryId} setCategoryId={setCategoryId}
          includeRemoved={includeRemoved} setIncludeRemoved={setIncludeRemoved} reload={data.reload} reloadCategories={categories.reload}
        />
      )}
    </div>
  );
}
