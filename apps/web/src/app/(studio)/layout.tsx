import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/supabase/server";
import { workspaceForUser } from "@/lib/auth/principal";
import { Providers, type StudioSession } from "@/components/providers";
import { Shell } from "@/components/shell/shell";

/**
 * Signed-in frame for every studio screen. Errors thrown here (for example an
 * invalid environment) are not caught by the sibling error.tsx; they reach
 * app/global-error.tsx, which points to the setup checklist.
 */
export default async function StudioLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const workspace = await workspaceForUser(user.id);
  const session: StudioSession = {
    userId: user.id,
    email: user.email ?? user.id,
    workspace,
    // Read directly (not through env()) so a display flag can never throw.
    demoMode: process.env.ENABLE_MOCK_PROVIDER === "true",
  };
  return (
    <Providers session={session}>
      <Shell email={session.email} workspace={workspace?.name ?? null} demoMode={session.demoMode}>
        {children}
      </Shell>
    </Providers>
  );
}
