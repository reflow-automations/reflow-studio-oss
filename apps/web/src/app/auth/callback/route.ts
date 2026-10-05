import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { supabaseServer } from "@/lib/supabase/server";
import { safeNext } from "@/lib/utils/safe-next";

const OTP_TYPES: ReadonlySet<string> = new Set(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);

/** Completes email confirmation / magic-link sign-in (PKCE `code` or `token_hash` links). */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = safeNext(params.get("next"));
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  const supabase = await supabaseServer();

  let message = params.get("error_description") ?? "Could not complete sign-in";
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.url));
    message = error.message;
  } else if (tokenHash && type && OTP_TYPES.has(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType });
    if (!error) return NextResponse.redirect(new URL(next, request.url));
    message = error.message;
  }

  const login = new URL("/login", request.url);
  login.searchParams.set("error", message);
  login.searchParams.set("next", next);
  return NextResponse.redirect(login);
}
