import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/supabase/server";
import { CreateScreen } from "@/components/create/create-screen";

export const metadata: Metadata = { title: "Create image" };

export default async function CreateImagePage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/create/image");
  return <CreateScreen type="image" />;
}
