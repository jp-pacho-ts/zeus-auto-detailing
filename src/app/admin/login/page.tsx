import { redirect } from "next/navigation";
import { getStaffSession, safeNextPath } from "@/server/auth/guards";
import type { StaffSession } from "@/server/auth/types";
import { LoginForm } from "./login-form";

interface AdminLoginPageProps {
  searchParams: Promise<{ next?: string | string[]; signedOut?: string | string[] }>;
}

export default async function AdminLoginPage({ searchParams }: AdminLoginPageProps) {
  const params = await searchParams;
  const next = safeNextPath(params.next) ?? "/admin";
  let session: StaffSession | null = null;
  try {
    session = await getStaffSession();
  } catch {
    // Session check unavailable: show the form; a sign-in attempt reports the outage.
  }
  if (session) redirect(next);
  return <LoginForm next={next} signedOut={params.signedOut === "1"} />;
}
