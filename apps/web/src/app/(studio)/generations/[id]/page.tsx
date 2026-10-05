import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import type { GenerationView } from "@/lib/studio";
import { getStudio } from "@/lib/studio";
import { currentUser } from "@/lib/supabase/server";
import { workspaceForUser } from "@/lib/auth/principal";
import { GenerationDetail } from "@/components/generations/generation-detail";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/generations/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  return { title: `Generation ${id.slice(0, 8)}` };
}

export default async function GenerationPage(props: PageProps<"/generations/[id]">) {
  const { id } = await props.params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=/generations/${id}`);
  const workspace = await workspaceForUser(user.id);
  if (!workspace) notFound();

  let generation: GenerationView | null = null;
  try {
    generation = await getStudio().getGeneration(id, { workspaceId: workspace.id, refresh: true });
  } catch {
    generation = null;
  }
  if (!generation) notFound();
  return <GenerationDetail generation={generation} />;
}
