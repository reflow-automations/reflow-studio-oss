import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/supabase/server";
import { LibraryScreen } from "@/components/library/library-screen";

export const metadata: Metadata = { title: "Library" };

export default async function LibraryPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/library");
  return <LibraryScreen />;
}
