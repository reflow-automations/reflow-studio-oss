import type { Metadata, Route } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { checkOwner, ownerDeniedMessage, signupEnabled } from "@/lib/auth/owner";
import { currentSessionUser } from "@/lib/supabase/server";
import { safeNext } from "@/lib/utils/safe-next";
import { ownerAccountExists } from "@/lib/setup/owner";
import { LoginForm } from "@/components/auth/login-form";
import { AuthFrame } from "@/components/auth/auth-frame";
import { SignOutButton } from "@/components/shell/sign-out-button";
import { ErrorBanner } from "@/components/ui/banner";

export const metadata: Metadata = { title: "Sign in" };

function SetupLink() {
  return (
    <p className="mx-auto flex w-full max-w-sm flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-[13px] text-muted lg:justify-start">
      First time here?
      <Link href="/setup" className="group inline-flex items-center gap-1 rounded-xs font-medium text-accent hover:underline hover:underline-offset-4">
        Set up your studio
        <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </p>
  );
}

/** Show the setup link only until an owner account exists; never let a database hiccup break sign-in. */
async function needsSetup(): Promise<boolean> {
  try {
    return !(await ownerAccountExists());
  } catch {
    return false;
  }
}

export default async function LoginPage(props: PageProps<"/login">) {
  const params = await props.searchParams;
  const next = safeNext(typeof params.next === "string" ? params.next : null);
  const error = typeof params.error === "string" ? params.error : undefined;
  const user = await currentSessionUser();
  const setupFooter = (await needsSetup()) ? <SetupLink /> : undefined;

  if (user) {
    const owner = checkOwner(user.email);
    if (owner.allowed) redirect(next as Route);
    // Signed in, but not on the owner list: explain and offer a way out.
    return (
      <AuthFrame footer={setupFooter}>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-3xl font-semibold text-fg">Access denied</h1>
          <p className="text-sm text-muted">Signed in as {user.email ?? "an unknown account"}.</p>
        </div>
        <ErrorBanner title="This account cannot use this studio" message={ownerDeniedMessage(owner.reason)} />
        <SignOutButton variant="secondary" size="lg" className="w-full" />
      </AuthFrame>
    );
  }

  const denied = typeof params.denied === "string" ? params.denied : undefined;
  const deniedMessage = denied === "not_allowed" || denied === "owner_list_missing" ? ownerDeniedMessage(denied) : undefined;
  return (
    <AuthFrame footer={setupFooter}>
      <LoginForm next={next} initialError={error ?? deniedMessage} allowSignup={signupEnabled()} />
    </AuthFrame>
  );
}
