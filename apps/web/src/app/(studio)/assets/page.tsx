import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/supabase/server";
import { AssetsScreen } from "@/components/assets/assets-screen";

export const metadata: Metadata = { title: "Assets" };

export default async function AssetsPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/assets");
  return <AssetsScreen />;
}
