"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createFirstOwner } from "@/lib/setup/owner";
import { supabaseServer } from "@/lib/supabase/server";

export interface SetupActionState {
  /** Safe to show to the visitor. */
  error?: string;
  /** Machine-readable code from createFirstOwner (or "sign_in_failed"). */
  code?: string;
  status?: number;
  retryAfterSeconds?: number;
  /** Echoed back so the form keeps what the visitor typed (never the password or secret). */
  email?: string;
}

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** First x-forwarded-for hop (the client as seen by the edge), else x-real-ip. */
async function clientKey(): Promise<string | undefined> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || h.get("x-real-ip")?.trim() || undefined;
}

/** Create the first owner account with the deploy secret, then sign in. */
export async function createOwnerAction(_prev: SetupActionState, form: FormData): Promise<SetupActionState> {
  const email = field(form, "email").trim();
  const password = field(form, "password");
  const setupSecret = field(form, "setupSecret");

  const result = await createFirstOwner({ email, password, setupSecret, clientKey: await clientKey() });
  if (!result.ok) {
    return { error: result.message, code: result.code, status: result.status, retryAfterSeconds: result.retryAfterSeconds, email };
  }

  try {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.signInWithPassword({ email: result.email, password });
    if (error) throw error;
  } catch {
    return { error: "Your owner account was created, but signing in failed. Sign in on the login page.", code: "sign_in_failed", status: 500, email };
  }
  redirect("/create/image");
}
