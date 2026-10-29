"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

// P1-26 F6: "/" is statically generated, so a server-rendered year freezes at build time. The build year is only
// the server snapshot; the browser shows its own current year.
export function CurrentYear({ buildYear }: { buildYear: number }) {
  return useSyncExternalStore(subscribe, () => new Date().getFullYear(), () => buildYear);
}
