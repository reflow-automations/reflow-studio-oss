import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/supabase/server";
import { UsageScreen } from "@/components/usage/usage-screen";

export const metadata: Metadata = { title: "Usage" };

export default async function UsagePage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/usage");
  return <UsageScreen />;
}
