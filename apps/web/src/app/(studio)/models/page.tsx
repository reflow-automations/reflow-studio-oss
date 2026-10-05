import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/supabase/server";
import { ModelBrowser } from "@/components/models/model-browser";

export const metadata: Metadata = { title: "Models" };

export default async function ModelsPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/models");
  return <ModelBrowser />;
}
