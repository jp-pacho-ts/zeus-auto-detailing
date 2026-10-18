import { redirect } from "next/navigation";
import { getStaffSession, safeNextPath } from "@/server/auth/guards";
import type { StaffSession } from "@/server/auth/types";
import { LoginForm } from "./login-form";

interface AdminLoginPageProps {
  searchParams: Promise<{ next?: string | string[] }>;
}

export default async function AdminLoginPage({ searchParams }: AdminLoginPageProps) {
  const next = safeNextPath((await searchParams).next) ?? "/admin";
  let session: StaffSession | null = null;
  try {
    session = await getStaffSession();
  } catch {
    // Session check unavailable: show the form; a sign-in attempt reports the outage.
  }
  if (session) redirect(next);
  return <LoginForm next={next} />;
}
