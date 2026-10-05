import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/supabase/server";
import { CreateScreen } from "@/components/create/create-screen";

export const metadata: Metadata = { title: "Create video" };

export default async function CreateVideoPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/create/video");
  return <CreateScreen type="video" />;
}
